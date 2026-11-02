/**
 * @file One request through the server (ADR-039): the guards first (a refusal,
 *   or the token's swap for the session cookie), then the event streams, the
 *   JSON routes, and the page.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ServerContext } from "./context.ts";
import { STREAMS } from "./contract.ts";
import { guard } from "./guards.ts";
import { BASE_HEADERS, sendError } from "./http.ts";
import { sendNotice, sendPage } from "./page.ts";
import { readRoutes } from "./read-routes.ts";
import { compilePath, route } from "./router.ts";
import { overviewStream, runStream } from "./streams.ts";
import { writeRoutes } from "./write-routes.ts";

export type Dispatch = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

const RUN_STREAM = compilePath(STREAMS.run);

export const createDispatch = (
  context: ServerContext,
  access: { port: () => number; token: string; shutdown: AbortSignal },
): Dispatch => {
  const handlers = { ...readRoutes(context), ...writeRoutes(context) };
  return async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const api = url.pathname.startsWith("/api/");
    const verdict = guard(
      { method, url: req.url ?? "/", headers: req.headers },
      { port: access.port(), token: access.token },
    );
    if (verdict.kind === "refuse") {
      if (api) sendError(res, verdict.status, verdict.error);
      else sendNotice(res, verdict.status, verdict.error);
      return;
    }
    if (verdict.kind === "exchange") {
      res
        .writeHead(302, {
          ...BASE_HEADERS,
          location: verdict.location,
          "set-cookie": verdict.cookie,
        })
        .end();
      return;
    }
    const streamed = RUN_STREAM.pattern.exec(url.pathname);
    if (method === "GET" && streamed !== null) {
      const id = decodeURIComponent(streamed[1] ?? "");
      await runStream(context, req, res, url, id, access.shutdown);
      return;
    }
    if (method === "GET" && url.pathname === STREAMS.overview) {
      overviewStream(context, res, url, access.shutdown);
      return;
    }
    if (await route(handlers, req, res, url)) return;
    if (api) sendError(res, 404, `No API route ${url.pathname}.`);
    else sendPage(res, method, url.pathname);
  };
};
