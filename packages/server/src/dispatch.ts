/**
 * @file One request through the server (ADR-039): the guards first (a refusal,
 *   or a sign-in code's swap for the session cookie), then the event streams,
 *   the JSON routes, and the page (the built UI, or the placeholder).
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { apiRoutes } from "./api-routes.ts";
import type { ServerContext } from "./context.ts";
import { API, STREAMS } from "./contract.ts";
import { guard } from "./guards.ts";
import { BASE_HEADERS, sendError } from "./http.ts";
import { sendNotice, sendPage } from "./page.ts";
import { compilePath, route } from "./router.ts";
import { overviewStream, runStream } from "./streams.ts";
import { upgradeStream } from "./upgrade-stream.ts";

export type Dispatch = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

const RUN_STREAM = compilePath(STREAMS.run);

export const createDispatch = (
  context: ServerContext,
  access: {
    port: () => number;
    token: string;
    session: string;
    shutdown: AbortSignal;
  },
): Dispatch => {
  const handlers = apiRoutes(context, access.port);
  return async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const api = url.pathname.startsWith("/api/");
    const verdict = guard(
      { method, url: req.url ?? "/", headers: req.headers },
      {
        port: access.port(),
        token: access.token,
        session: access.session,
        codes: context.codes,
      },
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
    // A page holds the cookie, so a script in it could mint codes for ever.
    if (url.pathname === API.signIn.path && verdict.via !== "bearer") {
      sendError(res, 403, "Sign-in codes are minted with the API token only.");
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
    if (method === "GET" && url.pathname === STREAMS.upgrade) {
      upgradeStream(context, req, res, url, access.shutdown);
      return;
    }
    if (await route(handlers, req, res, url)) return;
    if (api) sendError(res, 404, `No API route ${url.pathname}.`);
    else sendPage(res, method, url.pathname, context.uiDir);
  };
};
