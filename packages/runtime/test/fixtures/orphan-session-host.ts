/**
 * @file A stand-in for `ork run` that a test signals: it runs one session
 *   through the session runner, with `sh` as the driver, and a SIGINT
 *   interrupts the session as `ork run`'s handler does. In `wait` mode the
 *   driver writes its pid and its child's to the file named by the second
 *   argument, then waits, noting a SIGINT there; in `end` mode it leaves a
 *   `nohup sleep`, writes its pid and exits, and the host says `ended` and
 *   stays up.
 */

import { appendFileSync } from "node:fs";

import type { SessionSpec } from "@krapht/ork-core";

import { type CliAdapter, createSessionRuntime } from "../../src/index.ts";

const [, , mode = "wait", file = ""] = process.argv;

const WAIT = `trap 'echo interrupted >> "$1"; exit 130' INT; sleep 30 >/dev/null 2>&1 & echo $$ $! > "$1"; wait`;
const END = `nohup sleep 30 >/dev/null 2>&1 & echo $! > "$1"; exit 0`;

const adapter: CliAdapter = {
  driver: "open-code",
  command: {
    bin: "sh",
    args: () => ["-c", mode === "end" ? END : WAIT, "sh", file],
  },
  decode: () => ({ events: [] }),
  mcp: {
    kind: "config-file",
    wire: () =>
      Promise.resolve({ args: [], env: {}, release: () => Promise.resolve() }),
  },
  permissions: { kind: "rules", denyByDefault: true },
  usage: { dollars: false, combine: (_earlier, later) => later },
  context: { instructions: [], skills: "", agents: "", env: () => ({}) },
};

const spec: SessionSpec = {
  nodeId: "worker",
  cwd: process.cwd(),
  prompt: "Wait",
  systemAppend: "",
  settingSources: ["project"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const session = createSessionRuntime(adapter).start(spec, {
  human: {
    permit: () => Promise.resolve({ allow: true as const }),
    ask: () => Promise.resolve("a"),
  },
});
process.once("SIGINT", () => {
  void session.interrupt();
});
for await (const event of session.events) void event;
if (mode === "end") {
  appendFileSync(file, "ended\n");
  setInterval(() => {
    // Stays up until the test kills it.
  }, 1000);
}
