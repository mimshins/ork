/**
 * @file Routing for the contract's JSON routes (ADR-039): matches a request to
 *   a route by method and path, checks its query and body against the route's
 *   schemas, and calls its handler, whose answer type the contract fixes.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { z } from "zod";

import {
  API,
  type BodyOf,
  type Params,
  type QueryOf,
  type Responses,
  type Route,
  type RouteName,
} from "./contract.ts";
import { readJson, sendError, sendJson } from "./http.ts";

/** A handler's answer: the route's response, or an error with the CLI's text. */
export type Reply<T> =
  | { status: 200 | 202; body: T }
  | { status: 400 | 404 | 409; error: string };

export type Handler<K extends RouteName> = (input: {
  params: Params<K>;
  query: QueryOf<K>;
  body: BodyOf<K>;
}) => Reply<Responses[K]> | Promise<Reply<Responses[K]>>;

export type Handlers = { [K in RouteName]: Handler<K> };

export const ok = <T>(body: T): Reply<T> => ({ status: 200, body });

export const accepted = <T>(body: T): Reply<T> => ({ status: 202, body });

export const fail = (
  status: 400 | 404 | 409,
  error: string,
): { status: 400 | 404 | 409; error: string } => ({ status, error });

type Compiled = {
  name: RouteName;
  method: string;
  pattern: RegExp;
  keys: string[];
  query?: z.ZodType;
  body?: z.ZodType;
};

/** A path such as `/api/runs/:id` as a pattern with its param names. */
export const compilePath = (
  path: string,
): { pattern: RegExp; keys: string[] } => {
  const keys: string[] = [];
  const source = path.replaceAll(/:(\w+)/gu, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`, "u"), keys };
};

const isRouteName = (name: string): name is RouteName => name in API;

const compile = (name: RouteName): Compiled => {
  const spec: Route = API[name];
  const { pattern, keys } = compilePath(spec.path);
  const compiled: Compiled = { name, method: spec.method, pattern, keys };
  if (spec.query !== undefined) compiled.query = spec.query;
  if (spec.body !== undefined) compiled.body = spec.body;
  return compiled;
};

const ROUTES: readonly Compiled[] = Object.keys(API)
  .filter(name => isRouteName(name))
  .map(name => compile(name));

const issues = (error: z.ZodError): string =>
  error.issues
    .map(i =>
      i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join("; ");

const parse = (
  schema: z.ZodType | undefined,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  if (schema === undefined) return { ok: true, value: undefined };
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: issues(parsed.error) };
};

const decode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * Answers the request if a JSON route has its path, and returns whether one
 * did; a path with no route for the method gets 405.
 */
export const route = async (
  handlers: Handlers,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> => {
  const matches = ROUTES.map(r => ({ r, m: r.pattern.exec(url.pathname) }));
  const found = matches.filter(({ m }) => m !== null);
  if (found.length === 0) return false;
  const hit = found.find(({ r }) => r.method === req.method);
  if (hit === undefined || hit.m === null) {
    sendError(res, 405, `${req.method ?? ""} is not allowed here.`);
    return true;
  }
  const { r, m } = hit;
  const params: Record<string, string> = {};
  for (const [i, key] of r.keys.entries()) {
    const value = decode(m[i + 1] ?? "");
    if (value === null) {
      sendError(res, 400, `The ${key} in the path is not valid.`);
      return true;
    }
    params[key] = value;
  }
  const query = parse(r.query, Object.fromEntries(url.searchParams));
  if (!query.ok) {
    sendError(res, 400, query.error);
    return true;
  }
  const read =
    req.method === "GET"
      ? { ok: true as const, value: undefined }
      : await readJson(req);
  if (!read.ok) {
    sendError(res, read.status, read.error);
    return true;
  }
  const body = parse(r.body, read.value);
  if (!body.ok) {
    sendError(res, 400, body.error);
    return true;
  }
  const handler = handlers[r.name] as Handler<RouteName>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked against the route's own schemas above
  const input = { params, query: query.value, body: body.value } as Parameters<
    Handler<RouteName>
  >[0];
  const reply = await handler(input);
  if ("error" in reply) sendError(res, reply.status, reply.error);
  else sendJson(res, reply.status, reply.body);
  return true;
};
