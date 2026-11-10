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
 *   session told its question failed would. For the contract suite
 *   (`test/contract/`): `FAKE_ENDPOINT_FILE` gets the URL of Ork's endpoint, and
 *   `FAKE_SCENARIO` plays one case: `invalid-report` (a report outside the
 *   schema), `try-denied` (calls `Bash`, refused when `--disallowedTools` names
 *   it), `wait-message` (answers the next stdin message), `hang` (starts and
 *   waits to be interrupted) or `report-tool` (hands in a report through
 *   Ork's `report` tool, first one outside the schema, then one inside, and
 *   ends with no structured output). `end:<kind>` ends the session the way
 *   Claude Code says that cause (`end:turn_limit` is `error_max_turns`,
 *   `end:rate_limited` an `API Error: 429` result, …; `ENDS` below).
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

if (process.env.FAKE_ENDPOINT_FILE !== undefined) {
  writeFileSync(process.env.FAKE_ENDPOINT_FILE, mcp.url);
}

const scenario = process.env.FAKE_SCENARIO ?? "";
const init = () =>
  out({ type: "system", subtype: "init", session_id: "fake-1", model: flag("--model") ?? "fake", cwd: process.cwd() });
const finish = (text, report) =>
  out({
    type: "result",
    subtype: "success",
    session_id: "fake-1",
    result: text,
    structured_output: report,
    total_cost_usd: cost,
    num_turns: 1,
    duration_ms: 100,
    usage: USAGE,
  });
const PASS = { status: "pass", summary: "done", artifacts: {} };
const apiError = (status, type, message) =>
  `API Error: ${status} ${JSON.stringify({ type: "error", error: { type, message } })}`;
/** How Claude Code's result says each cause, for `end:<kind>`. */
const ENDS = {
  turn_limit: { subtype: "error_max_turns", errors: ["Reached maximum number of turns (5)"] },
  budget_limit: { subtype: "error_max_budget_usd", errors: ["Reached maximum budget ($0.5)"] },
  auth: { result: "Invalid API key · Please run /login" },
  out_of_credits: { result: "Credit balance is too low" },
  rate_limited: { result: apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit") },
  provider_unavailable: { result: apiError(529, "overloaded_error", "Overloaded") },
  model_unavailable: {
    result: apiError(400, "invalid_request_error", "This model does not support assistant message prefill. The conversation must end with a user message."),
  },
};
if (scenario.startsWith("end:")) {
  init();
  out({
    type: "result",
    subtype: "success",
    is_error: true,
    session_id: "fake-1",
    result: "",
    total_cost_usd: cost,
    num_turns: 1,
    duration_ms: 100,
    usage: USAGE,
    ...ENDS[scenario.slice(4)],
  });
  process.exit(1);
} else if (scenario === "hang") {
  init();
  await new Promise(() => setInterval(() => {}, 1000));
} else if (scenario === "try-denied") {
  init();
  const denied = (flag("--disallowedTools") ?? "").split(",").includes("Bash");
  out({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t9", name: "Bash", input: { command: "ls" } }] } });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t9", is_error: denied }] } });
  finish(denied ? "Bash was refused" : "Bash ran", PASS);
  process.exit(0);
} else if (scenario === "report-tool") {
  init();
  const calls = [{ status: "maybe", summary: 3 }, PASS];
  for (const [index, report] of calls.entries()) {
    const id = `r${index}`;
    out({ type: "assistant", message: { id, content: [{ type: "tool_use", id, name: "mcp__ork__report", input: report }] } });
    const reply = await rpc("tools/call", { name: "report", arguments: report });
    const failing = reply.result?.isError === true || reply.error !== undefined;
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: failing }] } });
    out({ type: "assistant", message: { id: `${id}-said`, content: [{ type: "text", text: reply.result?.content[0].text ?? reply.error.message }] } });
  }
  finish("reported", null);
  process.exit(0);
} else if (scenario === "wait-message") {
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  await lines.next();
  init();
  const next = await lines.next();
  finish(`got: ${JSON.parse(next.value).message.content}`, PASS);
  process.exit(0);
}

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
    status: scenario === "invalid-report" ? "maybe" : failed ? "fail" : "pass",
    summary: `tools: ${tools.result.tools.map(t => t.name).join(",")}`,
    artifacts: { notes: "notes.md" },
    verdict: "approve",
  },
  total_cost_usd: cost,
  num_turns: 2,
  duration_ms: 1500,
  usage: USAGE,
});
