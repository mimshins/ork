#!/usr/bin/env node
/**
 * @file A stand-in for `codex app-server` (codex-cli 0.169.0), for the
 *   `codex-app-server` driver's tests (RFC-027). Its frames use the shapes of
 *   `fixtures/codex-app-server-session.ts`, which come from the protocol's
 *   generated schema; no real session was measured. `codex --version` and
 *   `codex login status` answer as `fake-codex.mjs` does. `codex app-server`
 *   takes `-c key=value`, `--enable`, `--disable`, `--listen`, `--stdio` and
 *   `--strict-config`, and refuses anything else (exit 2), `exec`'s
 *   `--ignore-user-config`, `--ignore-rules` and `--dangerously-bypass-hook-trust`
 *   included. Ork's endpoint comes from `-c mcp_servers.ork.url=…` (none: exit
 *   1, as `required=true` makes it), its token from the variable
 *   `-c mcp_servers.ork.bearer_token_env_var=…` names. It reads JSON-RPC frames
 *   (no `jsonrpc` field) one per line: `initialize`, `hooks/list` (Ork's hook,
 *   source `sessionFlags`, when `-c hooks.PreToolUse` is given, and with
 *   `FAKE_CODEX_USER_HOOK=1` a user hook beside it), `thread/start` (thread
 *   `th-fake-1`), `thread/resume` (the id it names), `thread/fork`
 *   (`fork-of-<id>`), `turn/start` (its text is the prompt; the scenario plays),
 *   `turn/steer` (refused with no running turn or another turn's id) and
 *   `turn/interrupt` (the turn completes `interrupted`); any other method gets
 *   a -32601 error. Before each shell or MCP call it runs the hook's command
 *   through the shell, but only when the thread's `config.bypass_hook_trust`
 *   is `true` and `FAKE_CODEX_NO_HOOK` is not `1`; a call the hook refuses
 *   leaves no item, only a stderr line (as `codex exec` was measured, guessed
 *   here). Each model request sends `thread/tokenUsage/updated` (180 input of
 *   which 80 cached, 20 output, 5 reasoning, 5 cache-write). It follows
 *   fake-claude.mjs's protocol: `FAKE_ENDPOINT_FILE` gets the endpoint's URL,
 *   `FAKE_SPENT_FILE` is written once `spend` sent its usage, and
 *   `FAKE_SCENARIO` plays one case: unset (asks through Ork's `ask_user` on a
 *   first leg, then reports through `report`), `invalid-report`, `try-denied`
 *   (a shell `ls`), `wait-message` (ends with `got: <the steer>`), `hang`,
 *   `spend` (three requests, then waits), `report-tool`, `extract`,
 *   `end:<kind>` (an `error` notification and a failed turn with that cause's
 *   words), and `session`: a first leg runs `pnpm test` after asking Ork's
 *   approval, says `got: <the steer>` and waits; a resumed leg reports and ends
 *   with `resumed <thread>: <prompt>`. `FAKE_CODEX_RECORD` gets a JSON line
 *   per leg (`kind: "leg"`, its folder, arguments and the token it read), per
 *   frame read (`kind: "frame"`) and per approval answer (`kind: "approval"`).
 *   Stdin's end exits 0; SIGINT exits 130.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const env = process.env;
const out = frame => process.stdout.write(`${JSON.stringify(frame)}\n`);
const record = entry => {
  if (env.FAKE_CODEX_RECORD !== undefined) appendFileSync(env.FAKE_CODEX_RECORD, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
};

if (argv[0] === "--version") {
  process.stdout.write("codex-cli 0.169.0\n");
  process.exit(0);
}
if (argv[0] === "login" && argv[1] === "status") {
  process.stderr.write("Logged in using ChatGPT\n");
  process.exit(0);
}
if (argv[0] !== "app-server") {
  process.stderr.write(`error: unrecognized subcommand '${argv[0]}'\n`);
  process.exit(2);
}

const VALUED = new Set(["-c", "--enable", "--disable", "--listen"]);
const SWITCHES = new Set(["--stdio", "--strict-config"]);
const configs = {};
for (let i = 1; i < argv.length; i += 1) {
  const arg = argv[i];
  if (VALUED.has(arg)) {
    if (arg === "-c") {
      const [key, ...value] = argv[i + 1].split("=");
      configs[key] = value.join("=");
    }
    i += 1;
  } else if (!SWITCHES.has(arg)) {
    process.stderr.write(`error: unexpected argument '${arg}' found\n`);
    process.exit(2);
  }
}
/** A `-c` value: TOML basic strings are JSON strings; the rest as written. */
const value = key => {
  const raw = configs[key];
  return raw?.startsWith('"') ? JSON.parse(raw) : raw;
};

const url = value("mcp_servers.ork.url");
const tokenVar = value("mcp_servers.ork.bearer_token_env_var");
const token = tokenVar === undefined ? undefined : env[tokenVar];
const scenario = env.FAKE_SCENARIO ?? "";
record({ kind: "leg", cwd: process.cwd(), args: argv, token });
if (url === undefined) {
  process.stderr.write("Error: MCP server `ork` is required but failed to start\n");
  process.exit(1);
}
if (env.FAKE_ENDPOINT_FILE !== undefined) writeFileSync(env.FAKE_ENDPOINT_FILE, url);
process.on("SIGINT", () => process.exit(130));

// The hook's command, from `[{matcher = ".*", hooks = [{type = "command", command = "…"}]}]`.
const hookCommand = (() => {
  const found = /command = ("(?:[^"\\]|\\.)*")/u.exec(configs["hooks.PreToolUse"] ?? "");
  return found === null ? undefined : JSON.parse(found[1]);
})();
/** Set by the thread request's `config`: without it the hook is untrusted and never runs. */
let trusted = false;
/** The hook's refusal of a call, or `undefined` when it lets it run. */
const preToolUse = (toolName, toolInput) => {
  if (hookCommand === undefined || !trusted || env.FAKE_CODEX_NO_HOOK === "1") return undefined;
  const ran = spawnSync(hookCommand, {
    shell: true,
    encoding: "utf8",
    input: JSON.stringify({ session_id: threadId, cwd: process.cwd(), hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput }),
  });
  if (ran.stdout.trim() === "") return undefined;
  const said = JSON.parse(ran.stdout).hookSpecificOutput;
  return said?.permissionDecision === "deny" ? said.permissionDecisionReason : undefined;
};

const hooksListed = () => [
  ...(hookCommand === undefined
    ? []
    : [{ key: "ork", eventName: "preToolUse", handlerType: "command", command: hookCommand, source: "sessionFlags", enabled: true, trustStatus: "untrusted" }]),
  ...(env.FAKE_CODEX_USER_HOOK === "1"
    ? [{ key: "mine", eventName: "preToolUse", handlerType: "command", command: "./mine.sh", source: "user", sourcePath: `${env.CODEX_HOME}/config.toml`, enabled: true, trustStatus: "trusted" }]
    : []),
];

// node:http, not fetch: fetch gives up after 300 s with no response headers.
const post = body =>
  new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) };
    const req = request(url, { method: "POST", headers }, res => {
      let text = "";
      res.setEncoding("utf8").on("data", chunk => (text += chunk)).on("error", reject).on("end", () => resolve(text));
    });
    req.on("error", reject).end(JSON.stringify(body));
  }).then(JSON.parse);

let threadId = "";
let turns = 0;
let turnId = "";
let ended = true;
let items = 0;
const nextId = () => `item_${items++}`;
const at = () => ({ threadId, turnId });

/** Requests to Ork (approvals), waiting for its reply by id. */
let asked = 0;
const asking = new Map();
const ask = (method, params) =>
  new Promise(resolve => {
    asked += 1;
    const id = `srv-${asked}`;
    asking.set(id, resolve);
    out({ id, method, params });
  });

/** Steers, in order; `nextSteer` waits for one. */
const steers = [];
let steerWaiter;
const nextSteer = () => (steers.length > 0 ? Promise.resolve(steers.shift()) : new Promise(resolve => (steerWaiter = resolve)));

const total = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, cacheWriteInputTokens: 0 };
const LAST = { inputTokens: 180, cachedInputTokens: 80, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 200, cacheWriteInputTokens: 5 };
const usage = () => {
  for (const key of Object.keys(total)) total[key] += LAST[key];
  out({ method: "thread/tokenUsage/updated", params: { ...at(), tokenUsage: { total: { ...total }, last: LAST, modelContextWindow: 272_000 } } });
};

const complete = (status, error) => {
  if (ended) return;
  ended = true;
  out({ method: "turn/completed", params: { threadId, turn: { id: turnId, status, items: [], ...(error === undefined ? {} : { error }) } } });
};
const say = text => out({ method: "item/completed", params: { ...at(), item: { type: "agentMessage", id: nextId(), text } } });
const finish = text => {
  say(text);
  usage();
  complete("completed");
};
const refused = (name, why) => {
  process.stderr.write(`hook refused ${name}: ${why}\n`);
  return { isError: true, text: why };
};

/** A shell command: the hook, Ork's approval when asked for, then its items. */
const shell = async (command, approval = false) => {
  const why = preToolUse("Bash", { command });
  if (why !== undefined) return refused("Bash", why);
  const item = { type: "commandExecution", id: nextId(), command, cwd: process.cwd(), commandActions: [], source: "agent" };
  out({ method: "item/started", params: { ...at(), item: { ...item, status: "inProgress" } } });
  if (approval) {
    const answer = await ask("item/commandExecution/requestApproval", { ...at(), itemId: item.id, kind: "command", command, cwd: process.cwd(), reason: "needs network access" });
    record({ kind: "approval", decision: answer?.decision });
    if (answer?.decision !== "accept") {
      out({ method: "item/completed", params: { ...at(), item: { ...item, status: "declined" } } });
      return { isError: true, text: "declined" };
    }
  }
  out({ method: "item/completed", params: { ...at(), item: { ...item, status: "completed", exitCode: 0, aggregatedOutput: "ok\n" } } });
  return { isError: false, text: "ok" };
};

/** One of Ork's tools: the hook, then the call, as `mcpToolCall` items. */
const callOrk = async (tool, args) => {
  const why = preToolUse(`mcp__ork__${tool}`, args);
  if (why !== undefined) return refused(`mcp__ork__${tool}`, why);
  const item = { type: "mcpToolCall", id: nextId(), server: "ork", tool, arguments: args };
  out({ method: "item/started", params: { ...at(), item: { ...item, status: "inProgress" } } });
  const reply = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } });
  const text = (reply.result?.content ?? []).map(c => c.text ?? "").join("");
  const isError = reply.result?.isError === true || reply.error !== undefined;
  out({
    method: "item/completed",
    params: {
      ...at(),
      item: {
        ...item,
        status: isError ? "failed" : "completed",
        ...(reply.error === undefined ? { result: { content: reply.result?.content ?? [] } } : { error: { message: reply.error.message } }),
      },
    },
  });
  return { isError, text: text || (reply.error?.message ?? "") };
};

/** The error Codex gives each cause, for `end:<kind>`, as `fake-codex.mjs` has them. */
const ENDS = {
  auth: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
  out_of_credits:
    'unexpected status 429 Too Many Requests: {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}',
  rate_limited: 'unexpected status 429 Too Many Requests: {"error":{"message":"Rate limit reached for requests","type":"requests","code":"rate_limit_exceeded"}}',
  provider_unavailable: "unexpected status 503 Service Unavailable: upstream connect error",
  model_unavailable: "The 'gpt-fake' model is not supported when using Codex with a ChatGPT account.",
};
const PASS = { status: "pass", summary: "done", artifacts: {} };
const waitForever = () => new Promise(() => undefined);

/** The scenario, played on a turn's prompt. */
const play = async (prompt, resumed) => {
  if (scenario.startsWith("end:")) {
    const said = ENDS[scenario.slice(4)];
    out({ method: "error", params: { ...at(), willRetry: false, error: { message: said } } });
    return complete("failed", { message: said });
  }
  if (scenario === "hang") return waitForever();
  if (scenario === "spend") {
    for (let i = 0; i < 3; i += 1) usage();
    if (env.FAKE_SPENT_FILE !== undefined) writeFileSync(env.FAKE_SPENT_FILE, "");
    return waitForever();
  }
  if (scenario === "try-denied") return finish((await shell("ls")).isError ? "shell was refused" : "shell ran");
  if (scenario === "wait-message") return finish(`got: ${await nextSteer()}`);
  if (scenario === "extract") return finish((await callOrk("extract", { steps: [{ step: "read", path: ".endpoint" }] })).text);
  if (scenario === "report-tool") {
    for (const report of [{ status: "maybe", summary: 3 }, PASS]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time
      say((await callOrk("report", report)).text);
    }
    usage();
    return complete("completed");
  }
  if (scenario === "session") {
    if (resumed) {
      await callOrk("report", PASS);
      return finish(`resumed ${threadId}: ${prompt}`);
    }
    say(`Working on: ${prompt}`);
    usage();
    say(`command ${(await shell("pnpm test", true)).isError ? "declined" : "ran"}`);
    say(`got: ${await nextSteer()}`);
    return waitForever();
  }
  if (!resumed) {
    say(`Working on: ${prompt}`);
    const answered = await callOrk("ask_user", { question: "Which way?", options: [{ id: "a" }, { id: "b" }], recommended: "a" });
    say(`asked: ${answered.text}`);
  }
  const reported = await callOrk("report", scenario === "invalid-report" ? { status: "maybe" } : PASS);
  return finish(reported.isError ? `report refused: ${reported.text}` : "reported");
};

const thread = id => ({ id, sessionId: id, cliVersion: "0.169.0", cwd: process.cwd(), ephemeral: false, modelProvider: "openai", source: "appServer", status: { type: "idle" }, turns: [] });
let resumed = false;

/** Answers one of Ork's requests; returns the result, or throws the error's words. */
const serve = (method, params) => {
  switch (method) {
    case "initialize":
      return { codexHome: env.CODEX_HOME ?? "", platformFamily: "unix", platformOs: "macos", userAgent: "codex_app_server/0.169.0" };
    case "hooks/list":
      return { data: (params?.cwds ?? []).map(cwd => ({ cwd, hooks: hooksListed(), errors: [], warnings: [] })) };
    case "thread/start":
    case "thread/resume":
    case "thread/fork": {
      trusted = params?.config?.bypass_hook_trust === true;
      resumed = method !== "thread/start";
      threadId = method === "thread/start" ? "th-fake-1" : method === "thread/fork" ? `fork-of-${params.threadId}` : params.threadId;
      out({ method: "thread/started", params: { thread: thread(threadId) } });
      return { thread: thread(threadId), model: params?.model ?? "gpt-fake", cwd: process.cwd(), approvalPolicy: params?.approvalPolicy, sandbox: { type: "workspaceWrite" } };
    }
    case "turn/start": {
      turns += 1;
      turnId = `turn-${turns}`;
      ended = false;
      return { turn: { id: turnId, status: "inProgress", items: [] } };
    }
    case "turn/steer": {
      if (ended || params?.expectedTurnId !== turnId) throw new Error("no active turn to steer");
      const text = (params.input ?? []).map(part => part.text ?? "").join("");
      if (steerWaiter === undefined) steers.push(text);
      else {
        steerWaiter(text);
        steerWaiter = undefined;
      }
      return { turnId };
    }
    case "turn/interrupt":
      return {};
    default:
      throw Object.assign(new Error(`unknown method ${method}`), { code: -32601 });
  }
};

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const frame = JSON.parse(line);
  record({ kind: "frame", frame });
  if (frame.method === undefined) {
    // Ork's reply to one of the fake's requests.
    asking.get(String(frame.id))?.(frame.result);
    asking.delete(String(frame.id));
    continue;
  }
  if (frame.id === undefined) continue;
  try {
    out({ id: frame.id, result: serve(frame.method, frame.params) });
  } catch (error) {
    out({ id: frame.id, error: { code: error.code ?? -32600, message: error.message } });
    continue;
  }
  if (frame.method === "turn/start") {
    out({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
    const prompt = (frame.params?.input ?? []).map(part => part.text ?? "").join("");
    void play(prompt, resumed);
  }
  if (frame.method === "turn/interrupt") complete("interrupted");
}
process.exit(0);
