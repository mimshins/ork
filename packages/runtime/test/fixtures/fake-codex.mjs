#!/usr/bin/env node
/**
 * @file A stand-in for OpenAI's `codex` (0.169.0), for the `codex` driver's
 *   tests. `codex --version` prints `codex-cli 0.169.0` and `codex login
 *   status` exits 0, as `ork doctor` probes them. `codex exec [resume <id> |
 *   fork <id>] --json … <message> …` prints the JSONL lines RFC-024's spike
 *   measured (`thread.started`, `turn.started`, `item.started`/`item.completed`
 *   with `agent_message`, `command_execution` or `mcp_tool_call` items,
 *   `turn.completed` with `usage`, `turn.failed`, top-level `error`) and no
 *   result line: it exits. It reads its options as Codex does, before or after
 *   the message, and refuses an option it does not know (exit 2). Ork's
 *   endpoint comes from `-c mcp_servers.ork.url=…`, its token from the
 *   variable `-c mcp_servers.ork.bearer_token_env_var=…` names; with no URL it
 *   fails to start, as `required=true` makes it. Before each shell or MCP call
 *   it runs the command of `-c hooks.PreToolUse=[…]` through the shell, the
 *   hook input on stdin, but only with `--dangerously-bypass-hook-trust` (the
 *   spike: without it the hook is skipped silently); a call the hook refuses
 *   leaves no item, only a stderr line. A resumed leg keeps its id; a fork's is
 *   `fork-of-<id>`. It follows fake-claude.mjs's protocol: `FAKE_ENDPOINT_FILE`
 *   gets the URL of Ork's endpoint, and `FAKE_SCENARIO` plays one case: unset
 *   (asks through Ork's `ask_user`, then reports through Ork's `report`),
 *   `invalid-report`, `try-denied` (a shell `git status`), `wait-message` (a slow first
 *   leg; a resumed one ends with `got: <the message>`), `hang` (starts and waits
 *   for SIGINT, then exits 130), `spend` (three `turn.completed` lines, where
 *   the real one prints one a leg, then waits as `hang` does), `report-tool`,
 *   `extract` (reads `.endpoint` through Ork's `extract` and ends with what it
 *   said), `edit` (a patch, then a shell command), `two-shells` (a shell `ls`,
 *   then two seconds later writes `late.txt` and runs a second one, so a leg
 *   Ork kills at the first never gets there) and `end:<kind>` (the error
 *   lines for that cause, exit 1; only `model_unavailable`'s words were
 *   measured, the others are OpenAI-shaped stand-ins). Codex has no turn
 *   limit, so there is no `end:turn_limit`. `FAKE_CODEX_RECORD` gets a line per
 *   leg: its folder, arguments, the token it read and its pid. `FAKE_CODEX_NO_HOOK=1`
 *   skips the hook, as a Codex that did not load it would.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);

if (argv[0] === "--version") {
  process.stdout.write("codex-cli 0.169.0\n");
  process.exit(0);
}
if (argv[0] === "login" && argv[1] === "status") {
  process.stderr.write("Logged in using ChatGPT\n");
  process.exit(0);
}
if (argv[0] !== "exec") {
  process.stderr.write(`error: unrecognized subcommand '${argv[0]}'\n`);
  process.exit(2);
}

const sub = argv[1] === "resume" || argv[1] === "fork" ? argv[1] : undefined;
const resumed = sub === undefined ? undefined : argv[2];
const rest = argv.slice(sub === undefined ? 1 : 3);

/** `exec`'s options as 0.169.0 names them: those taking a value, and switches. */
const VALUED = new Set(["-c", "-m", "--model", "--disable", "--enable", "--output-schema"]);
const SWITCHES = new Set(["--json", "--ignore-user-config", "--ignore-rules", "--dangerously-bypass-hook-trust"]);
const configs = {};
const positional = [];
for (let i = 0; i < rest.length; i += 1) {
  const arg = rest[i];
  if (VALUED.has(arg)) {
    if (arg === "-c") {
      const [key, ...value] = rest[i + 1].split("=");
      configs[key] = value.join("=");
    }
    i += 1;
  } else if (SWITCHES.has(arg)) {
    // A switch.
  } else if (arg.startsWith("-")) {
    process.stderr.write(`error: unexpected argument '${arg}' found\n`);
    process.exit(2);
  } else {
    positional.push(arg);
  }
}
const message = positional[0] ?? "";
/** A `-c` value: TOML basic strings are JSON strings; the rest as written. */
const value = key => {
  const raw = configs[key];
  return raw?.startsWith('"') ? JSON.parse(raw) : raw;
};

const session = resumed === undefined ? "th-fake-1" : sub === "fork" ? `fork-of-${resumed}` : resumed;
const url = value("mcp_servers.ork.url");
const tokenVar = value("mcp_servers.ork.bearer_token_env_var");
const token = tokenVar === undefined ? undefined : process.env[tokenVar];
const scenario = process.env.FAKE_SCENARIO ?? "";

if (process.env.FAKE_CODEX_RECORD !== undefined) {
  appendFileSync(process.env.FAKE_CODEX_RECORD, `${JSON.stringify({ cwd: process.cwd(), args: argv, token, pid: process.pid })}\n`);
}
if (url === undefined) {
  process.stderr.write("Error: MCP server `ork` is required but failed to start\n");
  process.exit(1);
}
if (process.env.FAKE_ENDPOINT_FILE !== undefined) writeFileSync(process.env.FAKE_ENDPOINT_FILE, url);

// The hook's command, from `[{matcher = ".*", hooks = [{type = "command", command = "…"}]}]`.
const hookCommand = (() => {
  const found = /command = ("(?:[^"\\]|\\.)*")/u.exec(configs["hooks.PreToolUse"] ?? "");
  const skipped = !argv.includes("--dangerously-bypass-hook-trust") || process.env.FAKE_CODEX_NO_HOOK === "1";
  return found === null || skipped ? undefined : JSON.parse(found[1]);
})();
/** The hook's refusal of a call, or `undefined` when it lets it run. */
const preToolUse = (toolName, toolInput) => {
  if (hookCommand === undefined) return undefined;
  const ran = spawnSync(hookCommand, {
    shell: true,
    encoding: "utf8",
    input: JSON.stringify({
      session_id: session,
      cwd: process.cwd(),
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      permission_mode: "bypassPermissions",
    }),
  });
  if (ran.stdout.trim() === "") return undefined;
  const said = JSON.parse(ran.stdout).hookSpecificOutput;
  return said?.permissionDecision === "deny" ? said.permissionDecisionReason : undefined;
};

// node:http, not fetch: fetch gives up after 300 s with no response headers,
// and an ask_user waits as long as the user takes to answer.
const post = body =>
  new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) };
    const req = request(url, { method: "POST", headers }, res => {
      let text = "";
      res.setEncoding("utf8").on("data", chunk => (text += chunk)).on("error", reject).on("end", () => resolve(text));
    });
    req.on("error", reject).end(JSON.stringify(body));
  }).then(JSON.parse);

let items = 0;
const nextId = () => `item_${items++}`;
const refused = (name, why) => {
  process.stderr.write(`hook refused ${name}: ${why}\n`);
  return { isError: true, text: why };
};

/** A shell command: the hook first, then its items. */
const shell = command => {
  const why = preToolUse("Bash", { command });
  if (why !== undefined) return refused("Bash", why);
  const id = nextId();
  const item = { id, type: "command_execution", command: `bash -lc ${command}`, aggregated_output: "", exit_code: null, status: "in_progress" };
  out({ type: "item.started", item });
  out({ type: "item.completed", item: { ...item, aggregated_output: "ok\n", exit_code: 0, status: "completed" } });
  return { isError: false, text: "ok" };
};

/** A patch: the hook sees `apply_patch` with the patch as its command. */
const patch = file => {
  const command = `*** Begin Patch\n*** Add File: ${file}\n+hi\n*** End Patch`;
  const why = preToolUse("apply_patch", { command });
  if (why !== undefined) return refused("apply_patch", why);
  const id = nextId();
  writeFileSync(file, "hi\n");
  out({ type: "item.started", item: { id, type: "file_change", changes: [{ path: file, kind: "add" }], status: "in_progress" } });
  out({ type: "item.completed", item: { id, type: "file_change", changes: [{ path: file, kind: "add" }], status: "completed" } });
  return { isError: false, text: "patched" };
};

/** One of Ork's tools: the hook, then the call, as `mcp_tool_call` items. */
const callOrk = async (tool, args) => {
  const why = preToolUse(`mcp__ork__${tool}`, args);
  if (why !== undefined) return refused(`mcp__ork__${tool}`, why);
  const id = nextId();
  const item = { id, type: "mcp_tool_call", server: "ork", tool, arguments: args, result: null, error: null, status: "in_progress" };
  out({ type: "item.started", item });
  const reply = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
  const text = (reply.result?.content ?? []).map(c => c.text ?? "").join("");
  const isError = reply.result?.isError === true || reply.error !== undefined;
  out({
    type: "item.completed",
    item: {
      ...item,
      result: reply.error === undefined ? { content: reply.result?.content ?? [] } : null,
      error: reply.error === undefined ? null : { message: reply.error.message },
      status: isError ? "failed" : "completed",
    },
  });
  return { isError, text: text || (reply.error?.message ?? "") };
};

const say = text => out({ type: "item.completed", item: { id: nextId(), type: "agent_message", text } });
const USAGE = { input_tokens: 180, cached_input_tokens: 80, cache_write_input_tokens: 5, output_tokens: 20, reasoning_output_tokens: 5 };
const turnDone = () => out({ type: "turn.completed", usage: USAGE });
const finish = said => {
  say(said);
  turnDone();
  process.exit(0);
};

out({ type: "thread.started", thread_id: session });
out({ type: "turn.started" });

/** The error Codex gives each cause, for `end:<kind>`; only the model's was measured. */
const ENDS = {
  auth: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
  out_of_credits:
    'unexpected status 429 Too Many Requests: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}',
  rate_limited:
    'unexpected status 429 Too Many Requests: {"error":{"message":"Rate limit reached for requests","type":"requests","code":"rate_limit_exceeded"}}',
  provider_unavailable: "unexpected status 503 Service Unavailable: upstream connect error",
  model_unavailable: "The 'gpt-fake' model is not supported when using Codex with a ChatGPT account.",
};
if (scenario.startsWith("end:")) {
  const said = ENDS[scenario.slice(4)];
  out({ type: "error", message: said });
  out({ type: "turn.failed", error: { message: said } });
  process.exit(1);
}

const PASS = { status: "pass", summary: "done", artifacts: {} };
if (scenario === "hang" || scenario === "spend") {
  process.on("SIGINT", () => process.exit(130));
  if (scenario === "spend") {
    for (let i = 0; i < 3; i += 1) turnDone();
    if (process.env.FAKE_SPENT_FILE !== undefined) writeFileSync(process.env.FAKE_SPENT_FILE, "");
  }
  await new Promise(() => setInterval(() => {}, 1000));
} else if (scenario === "try-denied") {
  finish(shell("git status").isError ? "shell was refused" : "shell ran");
} else if (scenario === "edit") {
  const patched = patch("b.txt");
  const ran = shell("git status");
  finish(`patch ${patched.isError ? "refused" : "ran"}, shell ${ran.isError ? "refused" : "ran"}`);
} else if (scenario === "two-shells") {
  shell("ls");
  await new Promise(resolve => setTimeout(resolve, 2000));
  writeFileSync("late.txt", "ran on\n");
  shell("ls");
  finish("both shells ran");
} else if (scenario === "wait-message") {
  if (resumed === undefined) {
    await new Promise(resolve => setTimeout(resolve, 300));
    finish("first leg");
  }
  finish(`got: ${message}`);
} else if (scenario === "extract") {
  finish((await callOrk("extract", { steps: [{ step: "read", path: ".endpoint" }] })).text);
} else if (scenario === "report-tool") {
  for (const report of [{ status: "maybe", summary: 3 }, PASS]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time
    say((await callOrk("report", report)).text);
  }
  turnDone();
  process.exit(0);
}

if (resumed === undefined) {
  say(`Working on: ${message}`);
  const asked = await callOrk("ask_user", { question: "Which way?", options: [{ id: "a" }, { id: "b" }], recommended: "a" });
  say(`asked: ${asked.text}`);
}
const reported = await callOrk("report", scenario === "invalid-report" ? { status: "maybe" } : PASS);
finish(reported.isError ? `report refused: ${reported.text}` : "reported");
