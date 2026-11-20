#!/usr/bin/env node
/**
 * @file A stand-in for oh-my-pi's `omp` (18.22.2), for the `omp` driver's
 *   tests (RFC-026, its "Capture legs" and the task 1 hand check). `omp
 *   --version` prints `omp/18.22.2`; `omp models --json` prints one model, or
 *   `FAKE_OMP_MODELS` verbatim (`fail` exits 1). `omp --mode rpc …` (RFC-027)
 *   starts as the real one does: another mode, a message argument, an unknown
 *   flag (`-p` and `--no-ui` included), or `-e`/`--extension`/`--hook`
 *   beside `--trusted-extension`, exits 2; a `--config` overlay that is missing
 *   or not a YAML mapping, a `--trusted-extension` that is missing or throws
 *   while it loads, a `--resume`/`--fork` session not in `--session-dir`, and,
 *   with `OMP_MCP_REQUIRE_READY=1`, a `--plugin-dir` server that does not
 *   answer `tools/list`, each exit 1 with an `error: …` line on stderr and no
 *   line on stdout. Then it writes `ready` and reads Ork's frames, one per
 *   line: `get_state` (answered with `data.sessionId`), `prompt` (its `message`
 *   is the brief; the scenario plays), `steer` (its `message` is read at the
 *   next request; `wait-message` ends with `got: <it>`), `abort` (an aborted
 *   message and `turn_end` mid-turn, then the session settles, so a held call
 *   never runs) and `extension_ui_response`; each request gets a `response`
 *   by id. A script call with `ask: true` stands for a tool with no approval
 *   entry: after its `tool_execution_start` it sends a `setWidget` and a
 *   `select` (`Approve`, `Approve <tool> for this session`, `Deny`) and runs
 *   only on `Approve`. A session ends with `prompt_result` then
 *   `session_settled`, and stdin's end exits 0 once a `tool_call` handler still
 *   waiting has answered (at most 2 s). It prints the recorded line shapes: `session` (a
 *   fork's, and a resumed fork's, with `parentSession`), `advisor_cost_changed`, `agent_start`,
 *   `turn_start`, `message_start`/`message_update`/`message_end`,
 *   `tool_execution_start`/`_end`, `turn_end`, `agent_end`, and a resumed leg
 *   prints only its own messages. Each call passes `--tools` and the
 *   overlay's `tools.approval` (per name; with `approvalMode: always-ask` a
 *   name with no entry fails), then every `tool_call` handler the extensions
 *   registered, awaited one call at a time, each cut after
 *   `extensionHandlers.toolCallTimeoutMs`. Nothing is printed while a handler
 *   waits; the assistant `message_end` comes after the last answer, then the
 *   calls run concurrently. A refused call still gets `tool_execution_end`
 *   with `isError: true` and the reason, and no `tool_result` event; a call
 *   that ran gets one. A script call refused as paused ("Ork paused this
 *   node") marks its step in the session's file, and a resumed leg plays the
 *   script from it. SIGINT exits 130 at once (mid-turn after an aborted
 *   assistant message and `turn_end`); with `FAKE_OMP_IGNORE_SIGINT=1` it is
 *   ignored. `--max-cost` counts the whole session (its spend is kept in the
 *   session's file): over it before a request, it prints a `cost-gate`
 *   `notice` and `agent_end`, and the prompt ends in a `cost_cap` error; a
 *   resumed leg already over it prints the notice only. Each request uses 100 input,
 *   20 output, 80 cache-read and 5 cache-write tokens, and `FAKE_OMP_COST`
 *   dollars (0.001). It follows fake-claude.mjs's protocol: `FAKE_ENDPOINT_FILE`
 *   gets the URL of Ork's endpoint, `FAKE_SPENT_FILE` is written once `spend`
 *   printed its usage, and `FAKE_SCENARIO` plays one case: unset (asks through
 *   Ork's `ask_user` on a first leg, then reports through Ork's `report`),
 *   `invalid-report`, `report-tool`, `try-denied` (a `bash` `git status`), `extract`,
 *   `wait-message`, `hang`, `spend` (three requests, then waits as `hang` does)
 *   and `end:<kind>` (exit 1 with that cause's words on stderr; `budget_limit`
 *   spends past `--max-cost`; the words are stand-ins except
 *   `model_unavailable`'s and `auth`'s). `FAKE_OMP_SCRIPT`, a JSON list of
 *   requests (`{ "calls": [{ "tool": "bash", "input": {…} }, { "ork":
 *   "report", "input": {…} }] }` or `{ "say": "…" }`), replaces the scenario.
 *   `FAKE_OMP_RECORD` gets a JSON line per leg (`kind: "leg"`, `args`, `env`,
 *   `cwd`, `pid`), per call shown to the handlers (`kind: "asked"`), per call
 *   refused (`kind: "refused"`, `reason`), per call that ran (`kind:
 *   "ran"`), each with `pid`, `toolCallId`, `tool` and `input`, per approval
 *   (`kind: "approval"`, `value`) and per frame read (`kind: "frame"`). Flags the real
 *   `omp` has but Ork never passes are unknown here, so a leg that passes one
 *   fails loudly.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const env = process.env;
/** Set once the session settled: nothing after is the session's but responses. */
let done = false;
const write = line => process.stdout.write(`${JSON.stringify(line)}\n`);
const out = line => {
  if (!done) write(line);
};
const fail = (code, text) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};
const record = entry => {
  if (env.FAKE_OMP_RECORD !== undefined) appendFileSync(env.FAKE_OMP_RECORD, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
};

if (argv[0] === "--version") {
  process.stdout.write("omp/18.22.2\n");
  process.exit(0);
}
if (argv[0] === "models") {
  if (env.FAKE_OMP_MODELS === "fail") fail(1, "error: could not list models");
  const one = { provider: "fake", kind: "model", id: "fake-model", selector: "fake/fake-model", name: "Fake", pricingStatus: "fixed" };
  process.stdout.write(`${env.FAKE_OMP_MODELS ?? JSON.stringify({ models: [one] })}\n`);
  process.exit(0);
}

record({ kind: "leg", cwd: process.cwd(), args: argv, env: { ...env } });

// The flags Ork passes, and the three a trusted extension cannot sit beside.
const VALUED = new Set([
  "--mode", "--model", "--thinking", "--append-system-prompt", "--session-dir", "--config", "--trusted-extension",
  "--plugin-dir", "--tools", "--max-cost", "--resume", "--fork", "-e", "--extension", "--hook",
]);
const SWITCHES = new Set([
  "--no-skills", "--no-rules", "--no-title", "--no-lsp", "--no-pty", "--no-prewalk", "--no-judge",
  "--no-spotlight", "--offline",
]);
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (VALUED.has(arg)) {
    if (argv[i + 1] === undefined) fail(2, `Error: ${arg} needs a value`);
    (flags[arg] ??= []).push(argv[(i += 1)]);
  } else if (SWITCHES.has(arg)) {
    flags[arg] = [true];
  } else if (arg.startsWith("-")) {
    fail(2, `Error: unknown flag: ${arg}`);
  } else {
    positional.push(arg);
  }
}
const flag = name => flags[name]?.at(-1);
const extensions = flags["--trusted-extension"] ?? [];
if (extensions.length > 0 && ["-e", "--extension", "--hook"].some(name => flags[name] !== undefined)) {
  fail(2, "Error: --trusted-extension cannot be combined with --extension, -e, or --hook");
}
if (flag("--mode") !== "rpc") fail(2, `Error: this stand-in runs only in rpc mode, not ${flag("--mode")}`);
if (positional.length > 0) fail(2, `Error: rpc mode takes no message argument: ${positional[0]}`);
if (flag("--resume") !== undefined && flag("--fork") !== undefined) fail(2, "Error: --resume and --fork cannot be combined");
const thinking = flag("--thinking") ?? "auto";
if (!LEVELS.has(thinking)) fail(2, `Error: invalid thinking level: ${thinking}`);

// A YAML subset enough for an overlay: block mappings and lists, flow lists,
// quoted and plain scalars, comments. JSON is YAML too.
const scalar = raw => {
  const text = raw.trim();
  if (text === "" || text === "~" || text === "null") return null;
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.startsWith("[")) return text.slice(1, -1).split(",").filter(item => item.trim() !== "").map(scalar);
  return text;
};
const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/u;
const parseYaml = text => {
  if (text.trimStart().startsWith("{")) return JSON.parse(text);
  const lines = text
    .split("\n")
    .map(line => (/^\s*#/u.test(line) ? "" : /["']/u.test(line) ? line : line.replace(/\s#.*$/u, "")))
    .filter(line => line.trim() !== "" && line.trim() !== "---")
    .map(line => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  let at = 0;
  const block = indent => {
    if (lines[at].text.startsWith("-")) {
      const list = [];
      while (at < lines.length && lines[at].indent === indent && lines[at].text.startsWith("-")) {
        list.push(scalar(lines[at].text.slice(1)));
        at += 1;
      }
      return list;
    }
    if (!KEY.test(lines[at].text)) return scalar(lines[at++].text);
    const map = {};
    while (at < lines.length && lines[at].indent === indent) {
      const [, rawKey, rest] = KEY.exec(lines[at].text) ?? [];
      if (rawKey === undefined) throw new Error(`bad line: ${lines[at].text}`);
      at += 1;
      const nested = at < lines.length && (lines[at].indent > indent || (lines[at].indent === indent && lines[at].text.startsWith("-")));
      map[scalar(rawKey)] = rest === undefined && nested ? block(lines[at].indent) : scalar(rest ?? "");
    }
    return map;
  };
  return lines.length === 0 ? null : block(lines[0].indent);
};

let settings = {};
const overlay = flag("--config");
if (overlay !== undefined) {
  if (!existsSync(overlay)) fail(1, `error: Config overlay not found: ${overlay}`);
  const parsed = parseYaml(readFileSync(overlay, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail(1, `error: Config overlay must be a YAML mapping: ${overlay}`);
  settings = parsed;
}
const setting = (...keys) => keys.reduce((at, key) => at?.[key], settings);

// The extensions: a default export that registers handlers with `pi.on`.
const handlers = {};
const pi = { on: (event, handler) => (handlers[event] ??= []).push(handler) };
for (const file of extensions) {
  if (!existsSync(file)) fail(1, `error: Trusted extension must be an existing module file: ${file}`);
  try {
    // oxlint-disable-next-line eslint/no-await-in-loop -- loaded in order, as omp does
    await (await import(pathToFileURL(path.resolve(file)).href)).default(pi);
  } catch (error) {
    fail(1, `error: Trusted extension failed to load: Failed to load extension: ${error.message}`);
  }
}

// node:http, not fetch: fetch gives up after 300 s with no response headers,
// and an ask_user waits as long as the user takes to answer.
const post = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { ...headers, "content-type": "application/json" } }, res => {
      let text = "";
      res
        .setEncoding("utf8")
        .on("data", chunk => (text += chunk))
        .on("error", reject)
        .on("end", () => (res.statusCode === 200 ? resolve(text) : reject(new Error(`status ${res.statusCode}`))));
    });
    req.on("error", reject).end(JSON.stringify(body));
  }).then(JSON.parse);

// The plugins' MCP servers, offered as `mcp__<plugin>_<server>_<tool>`.
const servers = (flags["--plugin-dir"] ?? []).flatMap(dir => {
  const manifest = path.join(dir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifest)) fail(1, `error: Plugin manifest not found: ${manifest}`);
  const plugin = JSON.parse(readFileSync(manifest, "utf8")).name;
  const mcpFile = path.join(dir, ".mcp.json");
  const found = existsSync(mcpFile) ? (JSON.parse(readFileSync(mcpFile, "utf8")).mcpServers ?? {}) : {};
  return Object.entries(found).map(([name, server]) => ({
    label: `${plugin}:${name}`,
    prefix: `mcp__${plugin.replaceAll("-", "_")}_${name}_`,
    url: server.url,
    headers: server.headers ?? {},
  }));
});
const rpc = (server, method, params) => post(server.url, server.headers, { jsonrpc: "2.0", id: 1, method, params });
if (env.OMP_MCP_REQUIRE_READY === "1") {
  for (const server of servers) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one server at a time
    const listed = await rpc(server, "tools/list", {}).catch(() => undefined);
    if (listed?.result === undefined) fail(1, `error: MCP servers not ready: ${server.label}`);
  }
}
if (env.FAKE_ENDPOINT_FILE !== undefined && servers[0] !== undefined) writeFileSync(env.FAKE_ENDPOINT_FILE, servers[0].url);

// The session's file in `--session-dir`: its id, folder and spend so far.
const sessionDir = flag("--session-dir") ?? path.join(env.PI_CODING_AGENT_DIR ?? path.join(env.HOME ?? homedir(), ".omp", "agent"), "sessions");
mkdirSync(sessionDir, { recursive: true });
const fileOf = id => path.join(sessionDir, `${id}.json`);
const source = flag("--resume") ?? flag("--fork");
if (source !== undefined && !existsSync(fileOf(source))) fail(1, `error: Session "${source}" not found`);
const before = source === undefined ? { spent: 0 } : JSON.parse(readFileSync(fileOf(source), "utf8"));
const forked = flag("--fork") !== undefined;
const session = {
  id: flag("--resume") ?? `fake-omp-${Date.now().toString(36)}-${process.pid}`,
  cwd: process.cwd(),
  spent: before.spent,
  // The script step whose call was refused as paused, made again on resume.
  paused: forked ? undefined : before.paused,
  // The stored header keeps its parent, so a resumed fork prints it again.
  ...(forked ? { parentSession: source } : before.parentSession === undefined ? {} : { parentSession: before.parentSession }),
};
const save = () => writeFileSync(fileOf(session.id), JSON.stringify(session));

const scenario = env.FAKE_SCENARIO ?? "";
/** The words `omp` gives each cause on stderr; only the model's and the login's are measured. */
const ENDS = {
  auth: "No default model selected. Use /login, or set an API key environment variable.",
  out_of_credits: "Error: Your credit balance is too low to access the Anthropic API.",
  rate_limited: "Error: 429 Too Many Requests: rate limit reached",
  provider_unavailable: "Error: 503 Service Unavailable: overloaded",
  model_unavailable: `Model "${flag("--model") ?? "fake/nope"}" not found`,
};
if (scenario.startsWith("end:") && ENDS[scenario.slice(4)] !== undefined) fail(1, ENDS[scenario.slice(4)]);

const maxCost = flag("--max-cost") === undefined ? Infinity : Number(flag("--max-cost"));
const notice = () => ({
  type: "notice",
  level: "error",
  message: `Session cost $${session.spent.toFixed(4)} reached the --max-cost limit of $${maxCost}`,
  source: "cost-gate",
});
save();
/** The session's header, printed once the prompt came, as print mode's first lines. */
const header = () => {
  out({
    type: "session",
    version: 3,
    id: session.id,
    timestamp: new Date().toISOString(),
    cwd: session.cwd,
    ...(session.parentSession === undefined ? {} : { parentSession: session.parentSession, providerPromptCacheKey: session.id }),
  });
  out({ type: "advisor_cost_changed" });
};

const [provider, ...modelParts] = (flag("--model") ?? "fake/default").split("/");
const model = modelParts.join("/") || provider;
const messages = [];
let brief = "";
let userPending = true;
let inTurn = false;
let toolCalls = 0;
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const spend = () => {
  const cost = Number(scenario === "end:budget_limit" ? Math.max(maxCost, 1) : (env.FAKE_OMP_COST ?? 0.001));
  return {
    input: 100,
    output: 20,
    cacheRead: 80,
    cacheWrite: 5,
    totalTokens: 205,
    cost: { input: cost * 0.5, output: cost * 0.3, cacheRead: cost * 0.1, cacheWrite: cost * 0.1, total: cost },
  };
};
const assistant = (content, usage, stopReason) => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider,
  model,
  usage,
  stopReason,
  timestamp: Date.now(),
  requestControls: { messageIndex: messages.length, tools: { declared: [], deferred: [], active: [] }, effort: { topLevel: thinking, tail: thinking } },
  responseId: `resp_${messages.length}`,
  credentialId: 7,
  duration: 10,
  ttft: 5,
  completedAt: Date.now(),
});
const show = message => {
  out({ type: "message_start", message });
  out({ type: "message_end", message });
  messages.push(message);
};
const agentEnd = () => out({ type: "agent_end", messages, isTerminal: true, yielded: false });
const park = () => new Promise(() => {});
/** The prompt's result, then the settled session; nothing of the session after. */
const settle = result => {
  out({ type: "prompt_result", ...result, sessionSettled: false });
  out({ type: "session_settled" });
  done = true;
  return park();
};
/** The cost gate's end; a leg over it before its first request prints no `agent_end`. */
const capEnd = (started = true) => {
  out(notice());
  if (started) agentEnd();
  return settle({ status: "error", error: { code: "cost_cap", message: notice().message } });
};

process.on("SIGINT", () => {
  if (env.FAKE_OMP_IGNORE_SIGINT === "1") return;
  if (inTurn) {
    const aborted = assistant([], ZERO, "aborted");
    out({ type: "message_start", message: aborted });
    out({ type: "message_end", message: aborted });
    out({ type: "turn_end", message: aborted, toolResults: [] });
  }
  process.exit(130);
});

/** The `tool_call` handlers' answer being awaited, if any: stdin's end waits for it. */
let asking;
/** Each `tool_call` handler in turn, cut after the overlay's timeout; the refusal's reason, or `undefined`. */
const askHandlers = event => {
  asking = handlersOf(event);
  return asking;
};
const handlersOf = async event => {
  const timeoutMs = setting("extensionHandlers", "toolCallTimeoutMs") ?? 30_000;
  for (const handler of handlers.tool_call ?? []) {
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Extension handler for tool_call timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- handlers answer one after another
      const answer = await Promise.race([Promise.resolve().then(() => handler(event)), timedOut]);
      if (answer?.block === true) return answer.reason ?? "Blocked by an extension";
    } catch (error) {
      return error.message;
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
};

/** Why `omp` itself refuses a call before any handler sees it, or `undefined`. */
const policyRefusal = name => {
  const offered = flag("--tools")?.split(",");
  const builtIn = !name.startsWith("mcp__");
  if (builtIn && offered !== undefined && !offered.includes(name)) return `Tool "${name}" is not available in this session`;
  if (!builtIn && !servers.some(server => name.startsWith(server.prefix))) return `Tool "${name}" not found`;
  const policy = setting("tools", "approval")?.[name];
  if (policy === "deny") return `Tool "${name}" is blocked by user policy. To allow: remove tools.approval.${name}`;
  if (policy !== "allow" && setting("tools", "approvalMode") === "always-ask") {
    return `Tool "${name}" requires approval but no interactive UI available`;
  }
  return undefined;
};

const shell = command =>
  new Promise(resolve => {
    const child = spawn("/bin/sh", ["-c", command], { cwd: process.cwd() });
    let text = "";
    child.stdout.on("data", chunk => (text += chunk));
    child.stderr.on("data", chunk => (text += chunk));
    child.on("close", code => resolve({ isError: code !== 0, text }));
  });

/** Runs a call `omp` and the handlers let through. */
const run = async ({ name, input }) => {
  const server = servers.find(each => name.startsWith(each.prefix));
  if (server !== undefined) {
    const reply = await rpc(server, "tools/call", { name: name.slice(server.prefix.length), arguments: input }).catch(error => ({ error }));
    const text = (reply.result?.content ?? []).map(c => c.text ?? "").join("") || (reply.error?.message ?? "");
    return { isError: reply.result?.isError === true || reply.error !== undefined, text };
  }
  const where = file => path.resolve(process.cwd(), String(file ?? "").replace(/:\d+(?:-\d+)?$/u, ""));
  try {
    if (name === "bash") return await shell(input.command);
    if (name === "read") return { isError: false, text: readFileSync(where(input.path), "utf8") };
    if (name === "write" || name === "edit") {
      // `edit`'s input is one string whose first line is `[PATH#HASH]`.
      const header = /^\[(.+?)#[^\]]*\]\n?([\s\S]*)$/u.exec(String(input.input)) ?? [];
      const [file, body] = name === "write" ? [input.path, input.content] : [header[1], header[2]];
      if (file === undefined) return { isError: true, text: "No path to edit" };
      mkdirSync(path.dirname(where(file)), { recursive: true });
      writeFileSync(where(file), body ?? "");
      return { isError: false, text: `Wrote ${file}` };
    }
    return { isError: false, text: "" };
  } catch (error) {
    return { isError: true, text: error.message };
  }
};

/** The tool's name as `omp` offers it: a built-in, or `{ ork }` through the plugin. */
const nameOf = call => (call.ork === undefined ? call.tool : `${servers[0]?.prefix ?? "mcp__ork_session_ork_"}${call.ork}`);

/** The host's answers to approval requests, by request id. */
const approvals = new Map();
let uiCount = 0;
/** Asks the host to approve `name`; the answer's `value`, or `cancelled`. */
const approve = name =>
  new Promise(resolve => {
    const id = `ui_${(uiCount += 1)}`;
    approvals.set(id, resolve);
    out({ type: "extension_ui_request", id, method: "setWidget", widget: "status" });
    out({ type: "extension_ui_request", id, method: "select", title: `Allow ${name}?`, options: ["Approve", `Approve ${name} for this session`, "Deny"] });
  });

/** One model request: its text and calls, the handlers, then the calls run. */
const turn = async ({ say, calls = [], stopReason }) => {
  if (session.spent >= maxCost) return capEnd();
  out({ type: "turn_start" });
  if (userPending) {
    userPending = false;
    show({ role: "user", content: [{ type: "text", text: brief }], attribution: "user", timestamp: Date.now() });
  }
  inTurn = true;
  const asked = calls.map(call => ({ id: `call_${(toolCalls += 1)}`, name: nameOf(call), input: call.input ?? {}, ask: call.ask === true }));
  const content = [
    { type: "thinking", thinking: "Thinking it over.", thinkingSignature: "sig-fake" },
    ...(say === undefined ? [] : [{ type: "text", text: say }]),
    ...asked.map(call => ({ type: "toolCall", id: call.id, name: call.name, arguments: { ...call.input, i: "intent" }, intent: "intent" })),
  ];
  out({ type: "message_start", message: assistant([], ZERO, "stop") });
  if (say !== undefined) out({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 1, content: say } });
  for (const call of asked) {
    const toolCall = { type: "toolCall", id: call.id, name: call.name, arguments: { ...call.input, i: "intent" } };
    out({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: content.length - 1, toolCall } });
  }
  // Silent while the handlers decide, one call at a time.
  for (const call of asked) {
    const tool = { toolCallId: call.id, tool: call.name, input: call.input };
    call.refused = policyRefusal(call.name);
    if (call.refused === undefined) {
      record({ kind: "asked", ...tool });
      // oxlint-disable-next-line eslint/no-await-in-loop -- omp asks the calls of one message one at a time
      call.refused = await askHandlers({ type: "tool_call", toolName: call.name, toolCallId: call.id, input: call.input });
    }
    if (call.refused !== undefined) record({ kind: "refused", ...tool, reason: call.refused });
    // A call refused as paused is made again by the resumed leg, from its step.
    if (PAUSED.test(call.refused ?? "")) {
      session.paused = step;
      save();
    }
  }
  // Aborted while a handler held a call: nothing more of this turn.
  if (done) return park();
  const usage = spend();
  session.spent += usage.cost.total;
  save();
  const message = assistant(content, usage, stopReason ?? (asked.length > 0 ? "toolUse" : "stop"));
  out({ type: "message_end", message });
  messages.push(message);
  // Each call starts; one with no approval entry asks the host before it runs.
  for (const call of asked) {
    out({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.input, intent: "intent" });
    if (call.ask && call.refused === undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one approval at a time
      const value = await approve(call.name);
      record({ kind: "approval", toolCallId: call.id, tool: call.name, value });
      if (value !== "Approve") call.refused = `Tool "${call.name}" was denied`;
    }
  }
  const toolResults = [];
  const results = await Promise.all(
    asked.map(async call => {
      const ran = call.refused === undefined;
      if (ran) record({ kind: "ran", toolCallId: call.id, tool: call.name, input: call.input });
      const result = ran ? await run(call) : { isError: true, text: call.refused };
      const body = { content: [{ type: "text", text: result.text }], details: call.name === "bash" ? { wallTimeMs: 1, trace: "trace" } : {} };
      out({ type: "tool_execution_end", toolCallId: call.id, toolName: call.name, result: body, isError: result.isError });
      const toolResult = { role: "toolResult", toolCallId: call.id, toolName: call.name, ...body, isError: result.isError, timestamp: Date.now() };
      show(toolResult);
      toolResults.push(toolResult);
      if (ran) {
        for (const handler of handlers.tool_result ?? []) {
          const event = { type: "tool_result", toolName: call.name, toolCallId: call.id, input: call.input, ...body, isError: result.isError };
          // oxlint-disable-next-line eslint/no-await-in-loop -- handlers answer one after another
          await Promise.resolve().then(() => handler(event)).catch(() => undefined);
        }
      }
      return { ...result, refused: !ran };
    }),
  );
  out({ type: "turn_end", message, toolResults });
  inTurn = false;
  return results;
};

/** The script step being played, kept as the paused one if a call is refused as paused. */
let step = 0;
const PAUSED = /^Ork paused this node/u;
const call = (...calls) => turn({ calls });
const finish = async say => {
  await turn({ say });
  agentEnd();
  return settle({ status: "completed" });
};

/** Messages steered in, read at the next request; a waiter for the next one. */
const steered = [];
let onSteer;
const nextSteer = () => (steered.length > 0 ? Promise.resolve(steered.shift()) : new Promise(resolve => (onSteer = resolve)));

const PASS = { status: "pass", summary: "done", artifacts: {} };
const resumed = flag("--resume") !== undefined;

/** Plays the scenario once the prompt came. */
const play = async () => {
  header();
  if (session.spent >= maxCost) return capEnd(false);
  // The step a paused call was refused at, played again once.
  const replay = resumed ? session.paused : undefined;
  session.paused = undefined;
  save();
  out({ type: "agent_start" });
  if (env.FAKE_OMP_SCRIPT !== undefined) {
    const steps = JSON.parse(env.FAKE_OMP_SCRIPT);
    for (step = replay ?? 0; step < steps.length; step += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
      if (steps[step].calls === undefined) await finish(steps[step].say);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
      else await call(...steps[step].calls);
    }
    return finish("done");
  }
  if (scenario === "hang") {
    out({ type: "turn_start" });
    inTurn = true;
    return park();
  }
  if (scenario === "spend") {
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
      await turn({ stopReason: "toolUse" });
    }
    if (env.FAKE_SPENT_FILE !== undefined) writeFileSync(env.FAKE_SPENT_FILE, "");
    return park();
  }
  if (scenario === "end:budget_limit") {
    await call({ tool: "bash", input: { command: "true" } });
    return finish("under the cap");
  }
  if (scenario === "try-denied") {
    const [shellRun] = await call({ tool: "bash", input: { command: "git status" } });
    return finish(shellRun.isError ? "shell was refused" : "shell ran");
  }
  if (scenario === "wait-message") return finish(`got: ${await nextSteer()}`);
  if (scenario === "extract") {
    const [read] = await call({ ork: "extract", input: { steps: [{ step: "read", path: ".endpoint" }] } });
    return finish(read.text);
  }
  if (scenario === "report-tool") {
    await call({ ork: "report", input: { status: "maybe", summary: 3 } });
    const [reported] = await call({ ork: "report", input: PASS });
    return finish(reported.isError ? "report refused" : "reported");
  }
  if (!resumed || replay !== undefined) {
    await call({ ork: "ask_user", input: { question: "Which way?", options: [{ id: "a" }, { id: "b" }], recommended: "a" } });
  }
  const [reported] = await call({ ork: "report", input: scenario === "invalid-report" ? { status: "maybe" } : PASS });
  return finish(reported.isError ? `report refused: ${reported.text}` : "reported");
};

const respond = (frame, extra = {}) => write({ type: "response", id: frame.id, command: frame.type, success: true, ...extra });
// The handshake, then the frames Ork writes, one per line; stdin's end ends the process.
write({ type: "ready", protocolVersion: 1, maxFrameBytes: 1_048_576 });
for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  record({ kind: "frame", frame });
  if (frame.type === "get_state") respond(frame, { data: { sessionId: session.id } });
  if (frame.type === "prompt") {
    respond(frame);
    brief = frame.message;
    void play();
  }
  if (frame.type === "steer") {
    respond(frame);
    if (onSteer === undefined) steered.push(frame.message);
    else onSteer(frame.message);
    onSteer = undefined;
  }
  if (frame.type === "abort") {
    respond(frame);
    if (inTurn) {
      const aborted = assistant([], ZERO, "aborted");
      out({ type: "message_start", message: aborted });
      out({ type: "message_end", message: aborted });
      out({ type: "turn_end", message: aborted, toolResults: [] });
    }
    void settle({ status: "aborted" });
  }
  if (frame.type === "extension_ui_response") {
    approvals.get(frame.id)?.(frame.cancelled === true ? "cancelled" : frame.value);
    approvals.delete(frame.id);
  }
}
// A handler still waiting (a held call Ork just stopped) gets its answer first,
// so what it refused is recorded whichever reaches the fake first; bounded.
await Promise.race([asking, new Promise(done => setTimeout(done, 2000))]);
process.exit(0);
