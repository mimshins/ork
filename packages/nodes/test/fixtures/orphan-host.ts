/**
 * @file A stand-in for `ork run` that a test SIGKILLs: it runs a tool through
 *   `spawnTool` that writes its process group id to the file named by its
 *   first argument, then leaves a background `sleep` and waits on another.
 */

import { tmpdir } from "node:os";

import { spawnTool } from "../../src/spawn.ts";

const [, , file = ""] = process.argv;

await spawnTool(
  "sh",
  ["-c", `ps -o pgid= -p $$ > "$1"; sleep 30 & sleep 30`, "sh", file],
  { cwd: tmpdir(), signal: new AbortController().signal },
);
