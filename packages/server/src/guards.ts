/**
 * @file What the server lets in (ADR-039,
 *   specs/server/streams-contract-and-security.md#security): only its own
 *   loopback `Host` (against DNS rebinding); only with its token, from the
 *   session cookie or an `Authorization: Bearer` header; and, for a write sent
 *   with the cookie, only from its own `Origin` (against CSRF). The token in
 *   `?token=` is swapped once for the cookie, with a redirect that takes it out
 *   of the address bar. Pure: it reads the request's parts and decides.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

export type GuardRequest = {
  method: string;
  /** The path and query, as in the request line. */
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
};

export type GuardContext = { port: number; token: string };

export type Verdict =
  | { kind: "pass" }
  /** Set the session cookie and redirect to `location`. */
  | { kind: "exchange"; cookie: string; location: string }
  | { kind: "refuse"; status: 401 | 403 | 415; error: string };

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A new token: 32 random bytes. */
export const newToken = (): string => randomBytes(32).toString("base64url");

/** The session cookie's name; one per port, as cookies ignore ports. */
export const cookieName = (port: number): string => `ork_ui_${String(port)}`;

/** Whether `given` is the token, compared in constant time. */
export const sameToken = (given: string, token: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const header = (request: GuardRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** The server's own origins: `127.0.0.1` and `localhost` on its port. */
export const ownOrigins = (port: number): readonly string[] => [
  `http://127.0.0.1:${String(port)}`,
  `http://localhost:${String(port)}`,
];

const cookieValue = (request: GuardRequest, name: string): string | undefined =>
  (header(request, "cookie") ?? "")
    .split(";")
    .map(part => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");

const bearer = (request: GuardRequest): string | undefined => {
  const match = /^Bearer\s+(\S+)$/iu.exec(
    header(request, "authorization") ?? "",
  );
  return match?.[1];
};

/** The session cookie that holds `token`. */
export const sessionCookie = (port: number, token: string): string =>
  `${cookieName(port)}=${token}; HttpOnly; SameSite=Strict; Path=/`;

const exchange = (
  request: GuardRequest,
  context: GuardContext,
): Verdict | null => {
  const url = new URL(request.url, "http://127.0.0.1");
  const given = url.searchParams.get("token");
  if (given === null || request.method !== "GET") return null;
  if (!sameToken(given, context.token)) {
    return {
      kind: "refuse",
      status: 401,
      error:
        "That link's token is not this server's; open it again with `ork ui`.",
    };
  }
  url.searchParams.delete("token");
  return {
    kind: "exchange",
    cookie: sessionCookie(context.port, context.token),
    location: `${url.pathname}${url.search}`,
  };
};

/** Decides whether a request may go on. */
export const guard = (
  request: GuardRequest,
  context: GuardContext,
): Verdict => {
  const host = header(request, "host") ?? "";
  if (!ownOrigins(context.port).includes(`http://${host}`)) {
    return {
      kind: "refuse",
      status: 403,
      error: `Host ${host} is not this server.`,
    };
  }
  const exchanged = exchange(request, context);
  if (exchanged !== null) return exchanged;

  const fromBearer = bearer(request);
  const fromCookie = cookieValue(request, cookieName(context.port));
  const given = fromBearer ?? fromCookie;
  if (given === undefined || !sameToken(given, context.token)) {
    return {
      kind: "refuse",
      status: 401,
      error: "Not signed in; open the UI with `ork ui`.",
    };
  }
  if (!WRITES.has(request.method)) return { kind: "pass" };

  const origin = header(request, "origin");
  // A browser sends the cookie on its own, so a write with it must come from
  // this server's page; a bearer token is never sent by a browser on its own.
  const checked = fromBearer === undefined || origin !== undefined;
  if (
    checked &&
    (origin === undefined || !ownOrigins(context.port).includes(origin))
  ) {
    return {
      kind: "refuse",
      status: 403,
      error: `Origin ${origin ?? "(none)"} may not write here.`,
    };
  }
  const type = header(request, "content-type") ?? "";
  if (!/^application\/json\s*(;|$)/iu.test(type)) {
    return {
      kind: "refuse",
      status: 415,
      error: "Send JSON (Content-Type: application/json).",
    };
  }
  return { kind: "pass" };
};
