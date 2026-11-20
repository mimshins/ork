/**
 * @file A stand-in for the `ork` script that `detachRun` starts, for the tests
 *   of its deadline. Its environment says what it does: `ORK_TEST_EXIT` prints
 *   that and exits at once; otherwise it writes its pid to `ORK_TEST_PID_FILE`,
 *   touches the heartbeat file `detachRun` named every 100 ms for
 *   `ORK_TEST_BEAT_MS` (unset: never), and records `--run-id` in the store
 *   named by `ORK_TEST_STORE` `ORK_TEST_RECORD_MS` after it started (unset:
 *   never). Then it stays up, as a long run would, until something kills it.
 */

import { writeFileSync } from "node:fs";

import {
  beginHeartbeat,
  endHeartbeat,
  HEARTBEAT_ENV,
} from "../../src/remote/heartbeat.ts";

const began = Date.now();
const env = process.env;
const args = process.argv.slice(2);
const flag = (name: string): string => args[args.indexOf(name) + 1] ?? "";

/** Records the run as `stub-ork.ts` does, once `recordMs` have passed. */
const recordAfter = async (recordMs: number): Promise<void> => {
  // Loaded after the beat has begun: the store's import takes a while.
  const { openStore } = await import("../../src/index.ts");
  const store = openStore(env["ORK_TEST_STORE"] ?? "");
  const id = flag("--run-id");
  setTimeout(
    () => {
      store.begin({
        id,
        workflow: "feature",
        file: args[1] ?? "",
        project: process.cwd(),
      });
    },
    Math.max(0, began + recordMs - Date.now()),
  );
};

const stub = async (): Promise<void> => {
  const exit = env["ORK_TEST_EXIT"];
  if (exit !== undefined) {
    process.stderr.write(exit);
    process.exitCode = 1;
    return;
  }
  writeFileSync(env["ORK_TEST_PID_FILE"] ?? "", String(process.pid));
  const beatMs = env["ORK_TEST_BEAT_MS"];
  if (beatMs !== undefined) {
    beginHeartbeat(env[HEARTBEAT_ENV], 100);
    setTimeout(endHeartbeat, Number(beatMs));
  }
  const recordMs = env["ORK_TEST_RECORD_MS"];
  if (recordMs !== undefined) await recordAfter(Number(recordMs));
  // A long run: only a kill ends it.
  setInterval(() => {
    // Stays up.
  }, 60_000);
};

await stub();
