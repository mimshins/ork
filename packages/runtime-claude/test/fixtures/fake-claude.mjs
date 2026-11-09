#!/usr/bin/env node
/**
 * @file A stand-in for `claude -p` in stream-json mode, for the CLI driver's
 *   tests. It reads the brief from stdin, asks the user through Ork's MCP
 *   server (as the real CLI would call the ask_user tool), and ends with a
 *   structured report, like the real CLI's first result in print mode. With
 *   `--resume` it says which session it resumed. With a `PreToolUse` HTTP hook
 *   in `--settings` it calls the hook before the tool call, as the real CLI
 *   does: a `defer` ends the turn with the call pending (a marker file in its
 *   folder), and a `--resume` with that marker fires the hook again without
 *   reading a new message. With `FAKE_CLAUDE_ENV_FILE` set it writes there
 *   the `ENABLE_PROMPT_CACHING_1H` it was started with, and with
 *   `FAKE_CLAUDE_MEMORY_FILE` the `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. With
 *   `--resume <id> --fork-session` it is a fork: a new session (`fork-of-<id>`) that asks
 *   nothing and reports the first value its `--json-schema` allows for
 *   `choice` (or `FAKE_CLAUDE_FORK_CHOICE`), with a `note`;
 *   `FAKE_CLAUDE_FORK_FAIL=1` makes a fork fail. `FAKE_CLAUDE_NO_ASK=1` skips
 *   the question, `FAKE_CLAUDE_COST` sets `total_cost_usd`, `FAKE_CLAUDE_EDIT`
 *   writes the brief to that file in its folder. An `ask_user` that comes back as a tool error is reported as a failure, as a
 *   session told its question failed would.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const mcp = JSON.parse(flag("--mcp-config")).mcpServers.ork;
const settings = args.includes("--settings") ? JSON.parse(flag("--settings")) : {};
const hook = settings.hooks?.PreToolUse?.[0]?.hooks?.[0];
const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const pending = path.join(process.cwd(), ".fake-deferred");

const rpc = async (method, params) => {
  const response = await fetch(mcp.url, {
    method: "POST",
    headers: { ...mcp.headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
};

/** The hook's answer for the tool call, or none without a hook. */
const preToolUse = async () => {
  if (hook === undefined) return {};
  const response = await fetch(hook.url, {
    method: "POST",
    headers: { ...hook.headers, "content-type": "application/json" },
    body: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__ork__ask_user", tool_input: {} }),
  });
  return response.json();
};

const asks = process.env.FAKE_CLAUDE_NO_ASK !== "1";
const cost = Number(process.env.FAKE_CLAUDE_COST ?? 0.0123);

const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 };

/** The first stdin line's brief. */
const readBrief = async () => {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    return JSON.parse(line).message.content;
  }
  return "";
};

if (process.env.FAKE_CLAUDE_ENV_FILE !== undefined) {
  writeFileSync(process.env.FAKE_CLAUDE_ENV_FILE, process.env.ENABLE_PROMPT_CACHING_1H ?? "");
}
if (process.env.FAKE_CLAUDE_MEMORY_FILE !== undefined) {
  writeFileSync(
    process.env.FAKE_CLAUDE_MEMORY_FILE,
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? "",
  );
}

if (args.includes("--fork-session")) {
  const brief = await readBrief();
  const id = `fork-of-${flag("--resume")}`;
  out({ type: "system", subtype: "init", session_id: id, model: flag("--model") ?? "fake", cwd: process.cwd() });
  out({ type: "assistant", message: { id: "f1", content: [{ type: "text", text: `Considering: ${brief}` }] } });
  const schema = JSON.parse(flag("--json-schema") ?? "{}");
  const failing = process.env.FAKE_CLAUDE_FORK_FAIL === "1";
  out({
    type: "result",
    subtype: failing ? "error_max_turns" : "success",
    is_error: failing,
    session_id: id,
    result: "",
    ...(failing
      ? {}
      : {
          structured_output: {
            status: "done",
            summary: "answered",
            choice: process.env.FAKE_CLAUDE_FORK_CHOICE ?? schema.properties?.choice?.enum?.[0],
            note: "The spec settles it.",
          },
        }),
    total_cost_usd: 0.002,
    num_turns: 1,
    duration_ms: 300,
    usage: USAGE,
  });
  process.exit(0);
}

const resumingDeferred = args.includes("--resume") && existsSync(pending);
if (resumingDeferred) rmSync(pending);
const brief = resumingDeferred ? "the deferred call" : await readBrief();
const resumed = args.includes("--resume") ? ` (resuming ${flag("--resume")})` : "";
out({ type: "system", subtype: "init", session_id: "fake-1", model: flag("--model") ?? "fake", cwd: process.cwd() });
out({
  type: "assistant",
  message: {
    id: "m1",
    content: [
      { type: "text", text: `Working on: ${brief}${resumed}` },
      ...(asks ? [{ type: "tool_use", id: "t1", name: "mcp__ork__ask_user", input: {} }] : []),
    ],
  },
});
const verdict = asks ? await preToolUse() : {};
if (verdict.hookSpecificOutput?.permissionDecision === "defer") {
  writeFileSync(pending, "t1");
  out({
    type: "result",
    subtype: "success",
    stop_reason: "tool_deferred",
    session_id: "fake-1",
    result: "",
    deferred_tool_use: { id: "t1", name: "mcp__ork__ask_user", input: {} },
    total_cost_usd: 0.01,
    num_turns: 1,
    duration_ms: 500,
    usage: USAGE,
  });
  process.exit(0);
}
const tools = await rpc("tools/list", {});
if (process.env.FAKE_CLAUDE_EDIT !== undefined) {
  writeFileSync(path.join(process.cwd(), process.env.FAKE_CLAUDE_EDIT), `${brief}\n`);
}
const answer = asks
  ? await rpc("tools/call", {
      name: "ask_user",
      arguments: {
        question: "Which approach?",
        options: [{ id: "a" }, { id: "b" }],
        recommended: "a",
      },
    })
  : undefined;
const failed = answer?.result.isError === true;
if (asks) {
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: failed }] } });
}
out({
  type: "result",
  subtype: "success",
  session_id: "fake-1",
  result: answer?.result.content[0].text ?? "done",
  structured_output: {
    status: failed ? "fail" : "pass",
    summary: `tools: ${tools.result.tools.map(t => t.name).join(",")}`,
    artifacts: { notes: "notes.md" },
    verdict: "approve",
  },
  total_cost_usd: cost,
  num_turns: 2,
  duration_ms: 1500,
  usage: USAGE,
});
