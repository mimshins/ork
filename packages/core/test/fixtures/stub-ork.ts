/**
 * @file A stand-in for the `ork` script that `detachRun` starts: for `run …
 *   --run-id <id> --called-by <caller>/<node>` it records the called run in the
 *   store named by `ORK_TEST_STORE`, and for `resume <id>` it takes that run
 *   again, as `ork resume` does. Either way it then stays up, as a long run
 *   would, until something kills it.
 */

import { openStore } from "../../src/index.ts";

const args = process.argv.slice(2);
const store = openStore(process.env["ORK_TEST_STORE"] ?? "");
const flag = (name: string): string => args[args.indexOf(name) + 1] ?? "";

if (args[0] === "resume") {
  const id = args[1] ?? "";
  store.reopen(id);
  store.append(id, { type: "run.resumed", kept: [] });
} else {
  const id = flag("--run-id");
  store.begin({
    id,
    workflow: "feature",
    file: args[1] ?? "",
    project: process.cwd(),
    parent: flag("--called-by").split("/")[0] ?? "",
  });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow: "feature",
    entries: [],
    nodes: [],
  });
}

// A long run: only a kill ends it.
setInterval(() => {
  // Stays up.
}, 60_000);
