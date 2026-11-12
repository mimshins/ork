#!/usr/bin/env node
/**
 * @file A stand-in for Command Code's `cmd` (1.88.5), for the `command-code`
 *   driver's tests. `cmd mcp add|get|remove|list` keep MCP entries per folder
 *   in `$HOME/.commandcode/projects/<slug>/mcp.json`, as the real one does
 *   (measured; specs/architecture.md, "Command Code"). `cmd -p <brief>
 *   --output-format json` finds Ork's endpoint in the `ork` entry of its
 *   folder's local scope, then prints `{"type":"event"}` frames and one
 *   `{"type":"result"}` line, the shapes read from the real CLI's source. It
 *   follows fake-claude.mjs's protocol: `FAKE_ENDPOINT_FILE` gets the URL of
 *   Ork's endpoint, and `FAKE_SCENARIO` plays one case: unset (asks the user
 *   through Ork's `ask_user`, then reports through Ork's `report` tool),
 *   `invalid-report` (a report outside the schema), `try-denied` (a shell call),
 *   `wait-message` (a slow first leg; `--resume` ends with `got: <the
 *   message>`), `hang` (starts and waits to be interrupted), `spend` (three
 *   `model_request_end` frames, then waits as `hang` does), `report-tool`
 *   (Ork's `report` tool, first with a report outside the schema, then with
 *   one inside), `max-turns` (a `max_turns` result, exit code 8) and `end:<kind>`
 *   (the error result and exit code Command Code gives that cause; `ENDS`). It loads
 *   `--mod <file>` as Command Code does, and a call the mod's
 *   `beforeToolCall` blocks ends in a `tool_hook_blocked` frame. With
 *   `--resume <id> --fork-session` its session is `fork-of-<id>`.
 *   `FAKE_CMD_FAIL_ADD=1` makes `mcp add` fail and print its arguments, so a
 *   test can check the token never leaks.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);

const slug = realpathSync(process.cwd()).replaceAll(/[^a-zA-Z0-9]/gu, "-").replace(/^-+/u, "");
const localFile = path.join(process.env.HOME ?? homedir(), ".commandcode", "projects", slug, "mcp.json");
const readLocal = () => (existsSync(localFile) ? JSON.parse(readFileSync(localFile, "utf8")) : { mcpServers: {} });
const writeLocal = config => {
  mkdirSync(path.dirname(localFile), { recursive: true });
  writeFileSync(localFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
};

const mcp = () => {
  const [command, ...rest] = args.slice(1);
  const positional = rest.filter((arg, i) => !arg.startsWith("-") && !rest[i - 1]?.startsWith("-"));
  const [name, url] = positional;
  const config = readLocal();
  if (command === "add") {
    if (process.env.FAKE_CMD_FAIL_ADD === "1") {
      process.stderr.write(`Error: could not add ${args.join(" ")}\n`);
      process.exit(1);
    }
    const header = flag("--header");
    const headers = header === undefined ? {} : { [header.split(":")[0]]: header.slice(header.indexOf(":") + 1).trim() };
    config.mcpServers[name] = { transport: "http", enabled: true, url, ...(header === undefined ? {} : { headers }) };
    writeLocal(config);
    process.stdout.write(`✓ Added MCP server '${name}' to local config\n  URL: ${url}\n`);
  } else if (command === "remove" || command === "get") {
    if (config.mcpServers[name] === undefined) {
      process.stderr.write(`Error: MCP server '${name}' not found\n`);
      process.exit(1);
    }
    if (command === "remove") {
      delete config.mcpServers[name];
      writeLocal(config);
      process.stdout.write(`✓ Removed MCP server '${name}' from local config\n`);
    } else {
      process.stdout.write(`\nMCP Server: ${name}\n\n  Scope:     local\n  Transport: http\n  URL:       ${config.mcpServers[name].url}\n`);
    }
  } else if (command === "list") {
    for (const each of Object.keys(config.mcpServers)) process.stdout.write(`  ${each}  http  local\n`);
  }
  process.exit(0);
};

if (args[0] === "mcp") mcp();

// `-p` mode: Ork's endpoint comes from the folder's local-scope `ork` entry.
const ork = readLocal().mcpServers.ork;
const resumed = flag("--resume");
const session = resumed === undefined ? "fake-cmd-1" : args.includes("--fork-session") ? `fork-of-${resumed}` : resumed;
const brief = flag("-p") ?? "";
const scenario = process.env.FAKE_SCENARIO ?? "";
// `spend` marks, in FAKE_SPENT_FILE, that its usage lines are written.
const spent = () => {
  if (process.env.FAKE_SPENT_FILE !== undefined) writeFileSync(process.env.FAKE_SPENT_FILE, "");
};
const USAGE = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 5 };
const started = Date.now();

const event = body => out({ type: "event", event: body });
const finish = (finalText, subtype = "success", code = 0) => {
  const stopReason = subtype === "max_turns" ? "max_turns" : "end_turn";
  event({ type: "model_request_end", model: flag("--model") ?? "fake", usage: USAGE, stopReason });
  out({ type: "result", subtype, sessionId: session, stopReason, usage: USAGE, durationMs: Date.now() - started, finalText });
  process.exit(code);
};

if (ork === undefined) {
  out({ type: "result", subtype: "error", durationMs: 0, usage: USAGE, finalText: "", error: "no ork MCP server" });
  process.exit(1);
}
if (process.env.FAKE_ENDPOINT_FILE !== undefined) writeFileSync(process.env.FAKE_ENDPOINT_FILE, ork.url);

const rpc = async (method, params) => {
  const response = await fetch(ork.url, {
    method: "POST",
    headers: { ...ork.headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
};

// `--mod`: the session's mod, loaded as Command Code loads one (a default
// export taking the mod API); its `beforeToolCall` hooks may block a call.
const hooks = [];
const modFile = flag("--mod");
if (modFile !== undefined) {
  const mod = await import(pathToFileURL(modFile).href);
  mod.default({ hooks: hook => hooks.push(hook) });
}
const blocked = async (id, name, input) => {
  for (const hook of hooks) {
    const said = await hook.beforeToolCall?.({ toolCallId: id, toolName: name, input });
    if (said?.block === true) return said.additionalContext ?? "Blocked by a pre-tool hook.";
  }
  return undefined;
};

/** One tool call's frames, as the real CLI prints them. */
const toolCall = async (id, name, input, run) => {
  event({ type: "tool_queued", toolCallId: id, toolName: name, input });
  const why = await blocked(id, name, input);
  if (why !== undefined) {
    event({ type: "tool_hook_blocked", toolCallId: id, toolName: name, hookOutput: why });
    return { isError: true, text: why };
  }
  event({ type: "tool_running", toolCallId: id, toolName: name, description: name });
  const result = await run();
  event(
    result.isError
      ? { type: "tool_errored", toolCallId: id, toolName: name, error: result.text }
      : { type: "tool_completed", toolCallId: id, toolName: name, result: [{ type: "text", text: result.text }] },
  );
  return result;
};

const callOrk = (id, name, input) =>
  toolCall(id, `mcp__ork__${name}`, input, async () => {
    const response = await rpc("tools/call", { name, arguments: input });
    const text = (response.result?.content ?? []).map(c => c.text ?? "").join("");
    return { isError: response.result?.isError === true || response.error !== undefined, text };
  });

const say = text => {
  event({ type: "text_delta", delta: text });
  event({ type: "message_end", content: [{ type: "text", text }] });
};

event({ type: "run_start", sessionId: session });
event({ type: "turn_start", turnNumber: 1 });

/** The exit code and error Command Code gives each cause, for `end:<kind>`. */
const ENDS = {
  auth: [3, "Not authenticated. Run `cmd login` to sign in."],
  out_of_credits: [10, "You are out of credits."],
  rate_limited: [5, "Rate limited. Try again later."],
  provider_unavailable: [7, "The server returned an error (529)."],
  model_unavailable: [
    1,
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support assistant message prefill. The conversation must end with a user message."}}',
  ],
};
if (scenario === "end:turn_limit") {
  finish("", "max_turns", 8);
} else if (scenario.startsWith("end:")) {
  const [code, error] = ENDS[scenario.slice(4)];
  out({ type: "result", subtype: "error", sessionId: session, usage: USAGE, durationMs: 1, finalText: "", error });
  process.exit(code);
} else if (scenario === "hang") {
  await new Promise(() => setInterval(() => {}, 1000));
} else if (scenario === "spend") {
  for (let i = 0; i < 3; i += 1) {
    event({ type: "model_request_end", model: flag("--model") ?? "fake", usage: USAGE, stopReason: "tool_use" });
  }
  spent();
  await new Promise(() => setInterval(() => {}, 1000));
} else if (scenario === "max-turns") {
  finish("", "max_turns", 8);
} else if (scenario === "try-denied") {
  const { isError } = await toolCall("t9", "shell", { command: "ls" }, () => ({ isError: false, text: "ok" }));
  finish(isError ? "shell was refused" : "shell ran");
} else if (scenario === "wait-message") {
  if (resumed === undefined) {
    await new Promise(resolve => setTimeout(resolve, 300));
    finish("first leg");
  }
  finish(`got: ${brief}`);
} else if (scenario === "report-tool") {
  await callOrk("t3", "report", { status: "maybe", summary: 3 });
  const { isError } = await callOrk("t4", "report", { status: "pass", summary: "done", artifacts: {} });
  finish(isError ? "report refused" : "reported");
}

const PASS = { status: "pass", summary: "done", artifacts: {} };
const report = scenario === "invalid-report" ? { status: "maybe" } : PASS;
if (resumed === undefined) {
  const asked = await callOrk("t1", "ask_user", {
    question: "Which way?",
    options: [{ id: "a" }, { id: "b" }],
    recommended: "a",
  });
  say(`asked: ${asked.text}`);
}
const reported = await callOrk("t2", "report", report);
finish(reported.isError ? `report refused: ${reported.text}` : "reported");
