/**
 * @file The upgrade's Server-Sent Event stream (specs/cli/updates.md): the
 *   package manager's kept output after `Last-Event-ID` (or `?after=`), saying
 *   first when earlier lines were dropped, then each new line as it comes, and
 *   `end` with how it ended. A reload or a second tab reads the same job.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ServerContext } from "./context.ts";
import type { UpgradeOutput } from "./contract-update.ts";
import { openEventStream, sendError } from "./http.ts";
import { startAfter } from "./streams.ts";

const NO_JOB = "No upgrade has run since `ork ui` started.";

export const upgradeStream = (
  context: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  shutdown: AbortSignal,
): void => {
  const job = context.updates.job();
  if (job === null) {
    sendError(res, 404, NO_JOB);
    return;
  }
  const after = startAfter(req, url);
  if (after === null) {
    sendError(res, 400, "Last-Event-ID or after must be a sequence number.");
    return;
  }
  const stream = openEventStream(res);
  const { lines, dropped } = job.linesAfter(after);
  if (dropped) {
    const first = lines[0]?.seq ?? after + 1;
    const note: UpgradeOutput = {
      seq: first - 1,
      stream: "stderr",
      text: "Earlier lines dropped.",
    };
    stream.send("output", note);
  }
  for (const line of lines) stream.send("output", line, line.seq);
  const ended = job.end();
  if (ended !== null) {
    stream.send("end", ended);
    stream.close();
    return;
  }
  const stop = job.listen(event => {
    if (event.kind === "output") {
      stream.send("output", event.line, event.line.seq);
      return;
    }
    stream.send("end", event.end);
    stream.close();
  });
  stream.signal.addEventListener("abort", stop);
  shutdown.addEventListener(
    "abort",
    () => {
      stream.close();
    },
    { signal: stream.signal },
  );
};
