/**
 * @file `ork run --detach`: checks what the run would refuse (a `--follow-ups`
 *   that can't be taken) before any run folder is made, then starts the run in
 *   the background and says how to follow it.
 */

import { detachRun, type EventStore, newRunId } from "@krapht/ork-core";

import { detachHint, style, write, writeErr } from "../output.ts";

/** Starts the run in the background; `rawArgs` are `ork run`'s own, as typed. */
export const startDetached = async (
  store: EventStore,
  options: {
    rawArgs: readonly string[];
    cwd: string;
    /** The workflow, and where a run's folder goes. */
    target: { file: string; runDir: (runId: string) => string };
    /** `--node`: a single node, whose run id says so. */
    node: string | undefined;
  },
): Promise<void> => {
  const { rawArgs, cwd, target } = options;
  // Loaded here: brief.ts imports `ork run`'s own module.
  const { prepareFollowUps } = await import("../follow-ups/brief.ts");
  // Nothing is marked here: the run that starts marks what it takes.
  const checked = await prepareFollowUps(
    store,
    rawArgs,
    undefined,
    target,
    undefined,
    false,
  );
  if (checked === undefined) return;
  const single = options.node !== undefined && options.node !== "";
  const runId = newRunId(store, single ? "node-" : "");
  const detached = await detachRun({
    store,
    runId,
    args: [
      "run",
      ...rawArgs.filter(arg => arg !== "--detach"),
      "--run-id",
      runId,
    ],
    cwd,
    runDir: target.runDir(runId),
  });
  if (detached.ok) {
    write(`▸ run ${detached.runId} started in the background`);
    write(style("dim", `  ${detachHint(detached.runId)}`));
  } else {
    writeErr(detached.error);
    writeErr(style("dim", `(output: ${detached.log})`));
    process.exitCode = 1;
  }
};
