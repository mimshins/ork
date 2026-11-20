#!/usr/bin/env node
/**
 * @file A tiny tool that speaks JSON frames both ways, for the session runner's
 *   duplex tests. Arguments: the session it resumes (`-` for none), then the
 *   hold hook's URL and token. It says `ready`, answers each request with a
 *   `response` by id, and starts its session (`s1`, or the resumed one) at the
 *   prompt, saying what the prompt asks: `ask` asks to run `bash` and says the
 *   answer, then settles; `hold` calls the hold hook before a tool call and
 *   waits (`hold-nameless` does it before naming its session; `hold-wait`
 *   names it `s2`, whose resumed leg waits at `again`); any other text is
 *   said, then it settles if it is `again` and waits otherwise. A steer is
 *   said, and settles the session if it is `finish`; an `abort` settles it,
 *   aborted.
 */

import { request } from "node:http";
import { createInterface } from "node:readline";

const [resume, holdUrl, token] = process.argv.slice(2);
let session = resume === "-" ? "s1" : resume;
const out = frame => {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
};
const settle = text => out({ type: "settled", session, text, tokens: 5 });

const hook = () => {
  const req = request(holdUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  req.on("error", () => undefined);
  req.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }));
};

const onPrompt = text => {
  if (text === "hold-wait") session = "s2";
  if (text === "hold-nameless") session = "";
  else out({ type: "started", session });
  if (text.startsWith("hold")) {
    hook();
    return;
  }
  if (text === "ask") {
    out({ type: "ask", id: "a1", tool: "bash", args: { command: "ls" } });
    return;
  }
  out({ type: "said", text });
  if (text === "again" && session !== "s2") settle("again");
};

out({ type: "ready" });
for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  if (frame.type === "prompt") {
    out({ type: "response", id: frame.id });
    onPrompt(frame.text);
  }
  if (frame.type === "steer") {
    out({ type: "response", id: frame.id });
    out({ type: "said", text: frame.text });
    if (frame.text === "finish") settle("finished");
  }
  if (frame.type === "abort") {
    out({ type: "response", id: frame.id });
    settle("");
  }
  if (frame.type === "answer") {
    out({ type: "said", text: frame.value });
    settle("asked");
  }
}
