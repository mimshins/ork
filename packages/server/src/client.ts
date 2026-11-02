/**
 * @file The typed client of the API (ADR-039), built from the contract: a call
 *   names a route and passes its params, query and body, and gets the route's
 *   response type back, or the server's error. The UI uses it in the browser
 *   (the session cookie goes with each request on its own); scripts pass the
 *   token. It uses only `fetch`, so it runs in a browser and in Node.
 */

import {
  API,
  type BodyOf,
  fillPath,
  type Params,
  type QueryOf,
  type Responses,
  type RouteName,
} from "./contract.ts";

/** What a call takes: only the parts its route has. */
export type CallInput<K extends RouteName> = (keyof Params<K> extends never
  ? { params?: undefined }
  : { params: Params<K> }) &
  (QueryOf<K> extends undefined
    ? { query?: undefined }
    : { query?: QueryOf<K> }) &
  (BodyOf<K> extends undefined ? { body?: undefined } : { body: BodyOf<K> });

export type CallResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export type ClientOptions = {
  /** The server's origin; default: the page's own (`""`). */
  base?: string;
  /** Sent as a bearer token; a page uses its session cookie instead. */
  token?: string;
  fetch?: typeof fetch;
};

export type Client = {
  call: <K extends RouteName>(
    name: K,
    ...input: object extends CallInput<K>
      ? [input?: CallInput<K>]
      : [input: CallInput<K>]
  ) => Promise<CallResult<Responses[K]>>;
};

/** An object's string and number fields, as text. */
const entries = (value: unknown): [string, string][] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, field]: [string, unknown]) =>
        typeof field === "string" || typeof field === "number"
          ? [[key, String(field)] as [string, string]]
          : [],
      )
    : [];

const queryString = (query: unknown): string => {
  const search = new URLSearchParams();
  for (const [key, value] of entries(query)) search.set(key, value);
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
};

const errorOf = (body: unknown, status: number): string =>
  typeof body === "object" &&
  body !== null &&
  "error" in body &&
  typeof body.error === "string"
    ? body.error
    : `The server answered ${String(status)}.`;

export const createClient = (options: ClientOptions = {}): Client => {
  const send = options.fetch ?? fetch;
  return {
    call: async (name, ...[input]) => {
      const route = API[name];
      const parts: { params?: unknown; query?: unknown; body?: unknown } =
        input ?? {};
      const params = Object.fromEntries(entries(parts.params));
      const url = `${options.base ?? ""}${fillPath(route.path, params)}${queryString(parts.query)}`;
      const headers: Record<string, string> = { accept: "application/json" };
      if (options.token !== undefined) {
        headers["authorization"] = `Bearer ${options.token}`;
      }
      const init: RequestInit = { method: route.method, headers };
      if (route.method === "POST") {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(parts.body ?? {});
      }
      let response: Response;
      try {
        response = await send(url, init);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, status: 0, error: `No answer: ${reason}` };
      }
      const body: unknown = await response.json().catch(() => null);
      return response.ok
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server's handlers are checked against the contract
          { ok: true, status: response.status, data: body as never }
        : {
            ok: false,
            status: response.status,
            error: errorOf(body, response.status),
          };
    },
  };
};
