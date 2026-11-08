/**
 * @file The API's two Server-Sent Event streams
 *   (specs/server/streams-contract-and-security.md#streams). A run's stream
 *   sends its stored events after `Last-Event-ID`, then each new one as the run
 *   stores it, over the run's socket or by polling the store (core's
 *   `followEvents`, as `ork logs -f`), and ends with `end`. The overview stream
 *   sends the runs, the open decisions and what is known of versions whenever
 *   they change, comparing every second.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { followEvents, pendingDecisions } from "@krapht/ork-core";

import { projectOf, runOf, type ServerContext, viewOf } from "./context.ts";
import { openEventStream, sendError } from "./http.ts";

/** How often the overview stream compares the store. */
export const OVERVIEW_INTERVAL_MS = 1000;

/** How many runs the overview stream sends. */
const OVERVIEW_RUNS = 50;

/** The seq to start after: `Last-Event-ID`, else `?after=`, else 0. */
export const startAfter = (req: IncomingMessage, url: URL): number | null => {
  const header = req.headers["last-event-id"];
  const raw =
    (Array.isArray(header) ? header[0] : header) ??
    url.searchParams.get("after") ??
    "0";
  const after = Number(raw);
  return Number.isInteger(after) && after >= 0 ? after : null;
};

export const runStream = async (
  context: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  id: string,
  shutdown: AbortSignal,
): Promise<void> => {
  const found = runOf(context, id);
  if (!found.ok) {
    sendError(res, found.refusal.status, found.refusal.error);
    return;
  }
  const after = startAfter(req, url);
  if (after === null) {
    sendError(res, 400, "Last-Event-ID or after must be a sequence number.");
    return;
  }
  const stream = openEventStream(res);
  const end = await followEvents(
    context.store,
    found.run.id,
    stored => {
      stream.send("run-event", stored, stored.seq);
    },
    {
      follow: true,
      after,
      ...(context.home === undefined ? {} : { home: context.home }),
      signal: AbortSignal.any([stream.signal, shutdown]),
    },
  );
  if (end !== "aborted" && end !== "stored") {
    stream.send("end", { reason: end });
  }
  stream.close();
};

export const overviewStream = (
  context: ServerContext,
  res: ServerResponse,
  url: URL,
  shutdown: AbortSignal,
): void => {
  const key = url.searchParams.get("project");
  const root =
    key === null ? undefined : (projectOf(context, key)?.root ?? key);
  const workflow = url.searchParams.get("workflow");
  const stream = openEventStream(res);
  const last = { runs: "", decisions: "", version: "" };
  const tick = (): void => {
    const filter = root === undefined ? {} : { project: root };
    const runs = context.store
      .runs({ ...filter, limit: OVERVIEW_RUNS })
      .map(run => viewOf(context, run));
    const decisions = pendingDecisions(context.store, {
      ...filter,
      ...(workflow === null ? {} : { workflow }),
    });
    for (const [name, value] of [
      ["runs", runs],
      ["decisions", decisions],
      ["version", context.updates.info()],
    ] as const) {
      const text = JSON.stringify(value);
      if (text === last[name]) continue;
      last[name] = text;
      stream.send(name, value);
    }
  };
  tick();
  const timer = setInterval(tick, OVERVIEW_INTERVAL_MS);
  const stop = (): void => {
    clearInterval(timer);
    stream.close();
  };
  stream.signal.addEventListener("abort", stop);
  // Removed when the stream ends, so finished streams do not pile up.
  shutdown.addEventListener("abort", stop, { signal: stream.signal });
};
