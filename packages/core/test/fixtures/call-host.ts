/**
 * @file A stand-in for a caller's `ork run` and `ork resume` that a test
 *   SIGKILLs: `call <project>` records run `caller00` in the store named by
 *   `ORK_TEST_STORE` and starts a `workflow.call` through `createCalls` and the
 *   real `detachRun`, with `stub-ork.ts` as the `ork` script, then stays up.
 *   `resume <project> <out>` takes `caller00` again and makes the same call with
 *   what it had called (`adoptedCalls`), resuming through the real
 *   `detachResume`, and writes the call's result to `<out>`.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  adoptedCalls,
  createCalls,
  detachResume,
  detachRun,
  openStore,
} from "../../src/index.ts";

const [, , mode = "", root = "", out = ""] = process.argv;
const STUB = path.join(import.meta.dirname, "stub-ork.ts");
const store = openStore(process.env["ORK_TEST_STORE"] ?? "");

if (mode === "call") {
  store.begin({ id: "caller00", workflow: "start", file: "f", project: root });
} else {
  store.reopen("caller00");
}

const port = createCalls({
  store,
  runId: "caller00",
  place: {
    id: "own",
    root,
    dir: path.join(root, ".ork"),
    mode: "in-repo",
  },
  newId: () => "called01",
  emit: event => {
    store.append("caller00", event);
  },
  detach: options => detachRun({ ...options, script: STUB }),
  resume: run => detachResume(store, run, [], STUB),
  ...(mode === "call" ? {} : { adopt: adoptedCalls(store, "caller00") }),
});

const result = await port.invoke(
  {
    callId: "plan",
    workflow: "feature",
    inputs: {},
    wait: "none",
    channels: [],
    linked: () => {
      // No channels.
    },
  },
  new AbortController().signal,
);

if (mode === "call") {
  // A caller waiting on its call: only a kill ends it.
  setInterval(() => {
    // Stays up.
  }, 60_000);
} else {
  writeFileSync(out, JSON.stringify(result));
}
