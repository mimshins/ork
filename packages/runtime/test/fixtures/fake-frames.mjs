#!/usr/bin/env node
/**
 * @file A tiny tool that speaks JSON frames both ways, for the duplex leg's
 *   tests. It says `pid` and `ready` at start (`silent`: neither, and waits),
 *   answers each request with a `response` by id, and acts by its mode
 *   (`process.argv[2]`): `end` settles after the prompt; `wait` starts and
 *   waits, saying each steer (`refuse` gets an error response) and settling,
 *   aborted, on `abort`; `deaf` ignores `abort` and steers; `ask` asks to run
 *   `bash` and says the answer, then settles; `huge` writes a line over 1 MiB;
 *   `garbage` writes a line that is not JSON; `chunk` writes a `chunk` frame;
 *   `blank` writes blank lines, then settles; `crash` exits 3 with a reason on
 *   stderr; `exit-on-steer` exits at a steer without a response; `call` calls
 *   four host tools at once, says each `result` as `<id>:<text>`, and settles
 *   after the fourth; `call-hang` calls `ork_hang` and then acts as `wait`.
 *   For a codec that needs no `ready`: `mute` says nothing and answers
 *   nothing; `late-turn` says no `ready` and says `turn` 200 ms after the
 *   prompt, refusing a steer that comes sooner.
 */

import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "end";
const out = frame => {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
};
const unready = ["silent", "mute", "late-turn"];
let turning = mode !== "late-turn";

out({ type: "pid", pid: process.pid });
if (!unready.includes(mode)) out({ type: "ready" });

const CALLS = [
  ["c1", "ork_slow"],
  ["c2", "ork_fast"],
  ["c3", "ork_nope"],
  ["c4", "ork_throw"],
];
let results = 0;

const onPrompt = () => {
  out({ type: "started", session: "s1" });
  out({ type: "usage", tokens: 7 });
  if (mode === "late-turn") {
    setTimeout(() => {
      turning = true;
      out({ type: "turn" });
    }, 200);
  }
  if (mode === "end") out({ type: "settled", text: "done" });
  if (mode === "ask") {
    out({ type: "ask", id: "a1", tool: "bash", args: { command: "ls" } });
  }
  if (mode === "call") {
    for (const [id, tool] of CALLS) {
      out({ type: "call", id, tool, args: { n: 1 } });
    }
  }
  if (mode === "call-hang") out({ type: "call", id: "h1", tool: "ork_hang" });
  if (mode === "huge") process.stdout.write(`${"x".repeat(1_200_000)}\n`);
  if (mode === "chunk") out({ type: "chunk" });
  if (mode === "blank") {
    process.stdout.write("\n   \n");
    out({ type: "settled", text: "after blanks" });
  }
  if (mode === "garbage") {
    process.stderr.write("boom\n");
    // Later, so the leg has read the stderr when the bad line comes.
    setTimeout(() => process.stdout.write("not json\n"), 200);
  }
  if (mode === "crash") {
    process.stderr.write("provider exploded\n");
    process.exit(3);
  }
};

for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  if (frame.type === "prompt" && mode !== "mute") {
    out({ type: "response", id: frame.id });
    onPrompt();
  }
  if (frame.type === "steer" && mode === "exit-on-steer") process.exit(1);
  if (frame.type === "steer" && mode !== "deaf") {
    const refused = frame.text === "refuse" || !turning;
    out({ type: "response", id: frame.id, ...(refused ? { error: "no" } : {}) });
    if (!refused) out({ type: "said", text: frame.text });
  }
  if (frame.type === "abort" && mode !== "deaf") {
    out({ type: "response", id: frame.id });
    out({ type: "settled", text: "", aborted: true });
  }
  if (frame.type === "result") {
    out({ type: "said", text: `${frame.id}:${frame.text}` });
    results += 1;
    if (results === CALLS.length) out({ type: "settled", text: "called" });
  }
  if (frame.type === "answer") {
    out({ type: "said", text: frame.value });
    out({ type: "settled", text: "asked" });
  }
}
// stdin closed: a well-behaved tool exits; `deaf`, `silent` and `mute` stay up.
if (["deaf", "silent", "mute"].includes(mode)) setInterval(() => undefined, 1000);
