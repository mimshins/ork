#!/usr/bin/env node
/**
 * @file A stand-in for oh-my-pi's `omp` (18.22.2), for the `omp` driver's
 *   tests (RFC-026, its "Capture legs" and the task 1 hand check). `omp
 *   --version` prints `omp/18.22.2`; `omp models --json` prints one model, or
 *   `FAKE_OMP_MODELS` verbatim (`fail` exits 1). `omp -p --mode json … <brief>`
 *   starts as the real one does: an unknown flag, or `-e`/`--extension`/`--hook`
 *   beside `--trusted-extension`, exits 2; a `--config` overlay that is missing
 *   or not a YAML mapping, a `--trusted-extension` that is missing or throws
 *   while it loads, a `--resume`/`--fork` session not in `--session-dir`, and,
 *   with `OMP_MCP_REQUIRE_READY=1`, a `--plugin-dir` server that does not
 *   answer `tools/list`, each exit 1 with an `error: …` line on stderr and no
 *   line on stdout. Then it prints the recorded line shapes: `session` (a
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
 *   that ran gets one. A call refused with "Make the same call again" is made
 *   again in the next request. SIGINT exits 130 at once (mid-turn after an
 *   aborted assistant message and `turn_end`), so a held call never runs;
 *   with `FAKE_OMP_IGNORE_SIGINT=1` it is ignored, and the fake plays on until
 *   its scenario or script ends and exits. `--max-cost` counts the whole
 *   session (its spend is kept in the session's file): over it before a request, it prints a `cost-gate` `notice` and
 *   `agent_end` and exits 3; a resumed leg already over it prints `session`,
 *   `advisor_cost_changed` and the notice only. Each request uses 100 input,
 *   20 output, 80 cache-read and 5 cache-write tokens, and `FAKE_OMP_COST`
 *   dollars (0.001). It follows fake-claude.mjs's protocol: `FAKE_ENDPOINT_FILE`
 *   gets the URL of Ork's endpoint, `FAKE_SPENT_FILE` is written once `spend`
 *   printed its usage, and `FAKE_SCENARIO` plays one case: unset (asks through
 *   Ork's `ask_user` on a first leg, then reports through Ork's `report`),
 *   `invalid-report`, `report-tool`, `try-denied` (a `bash` `ls`), `extract`,
 *   `wait-message` (a slow first leg; a resumed one ends with `got: <the
 *   message>`), `hang`, `spend` (three requests, then waits as `hang` does)
 *   and `end:<kind>` (exit 1 with that cause's words on stderr; `budget_limit`
 *   spends past `--max-cost` and exits 3; the words are stand-ins except
 *   `model_unavailable`'s and `auth`'s). `FAKE_OMP_SCRIPT`, a JSON list of
 *   requests (`{ "calls": [{ "tool": "bash", "input": {…} }, { "ork":
 *   "report", "input": {…} }] }` or `{ "say": "…" }`), replaces the scenario.
 *   `FAKE_OMP_RECORD` gets a JSON line per leg (`kind: "leg"`, `args`, `env`,
 *   `cwd`, `pid`), per call shown to the handlers (`kind: "asked"`), per call
 *   refused (`kind: "refused"`, `reason`) and per call that ran (`kind:
 *   "ran"`), each with `pid`, `toolCallId`, `tool` and `input`. Flags the real
 *   `omp` has but Ork never passes are unknown here, so a leg that passes one
 *   fails loudly.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const env = process.env;
const out = line => process.stdout.write(`${JSON.stringify(line)}\n`);
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
  "-p", "--print", "--no-skills", "--no-rules", "--no-title", "--no-lsp", "--no-pty", "--no-prewalk", "--no-judge",
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
if (flag("-p") === undefined && flag("--print") === undefined) fail(2, "Error: this stand-in runs only in print mode (-p)");
if (flag("--mode") !== "json") fail(2, `Error: unsupported mode: ${flag("--mode")}`);
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
out({
  type: "session",
  version: 3,
  id: session.id,
  timestamp: new Date().toISOString(),
  cwd: session.cwd,
  ...(session.parentSession === undefined ? {} : { parentSession: session.parentSession, providerPromptCacheKey: session.id }),
});
out({ type: "advisor_cost_changed" });
if (session.spent >= maxCost) {
  out(notice());
  process.exit(3);
}

const [provider, ...modelParts] = (flag("--model") ?? "fake/default").split("/");
const model = modelParts.join("/") || provider;
const messages = [];
const brief = positional[0] ?? "";
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

/** Each `tool_call` handler in turn, cut after the overlay's timeout; the refusal's reason, or `undefined`. */
const askHandlers = async event => {
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

/** One model request: its text and calls, the handlers, then the calls run. */
const turn = async ({ say, calls = [], stopReason }) => {
  if (session.spent >= maxCost) {
    out(notice());
    agentEnd();
    process.exit(3);
  }
  out({ type: "turn_start" });
  if (userPending) {
    userPending = false;
    show({ role: "user", content: [{ type: "text", text: brief }], attribution: "user", timestamp: Date.now() });
  }
  inTurn = true;
  const asked = calls.map(call => ({ id: `call_${(toolCalls += 1)}`, name: nameOf(call), input: call.input ?? {} }));
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
  }
  const usage = spend();
  session.spent += usage.cost.total;
  save();
  const message = assistant(content, usage, stopReason ?? (asked.length > 0 ? "toolUse" : "stop"));
  out({ type: "message_end", message });
  messages.push(message);
  for (const call of asked) out({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: call.input, intent: "intent" });
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

const AGAIN = /Make the same call again/u;
/** Calls in one request; a call refused with a request to make it again is made again. */
const call = async (...calls) => {
  const results = await turn({ calls });
  for (let round = 0; round < 100; round += 1) {
    const again = results.flatMap((result, k) => (result.refused && AGAIN.test(result.text) ? [k] : []));
    if (again.length === 0) break;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next request waits for this one
    const redone = await turn({ calls: again.map(k => calls[k]) });
    again.forEach((k, j) => (results[k] = redone[j]));
  }
  return results;
};
const finish = async say => {
  await turn({ say });
  agentEnd();
  process.exit(0);
};
const waitForever = () => new Promise(() => setInterval(() => {}, 1000));

out({ type: "agent_start" });
const PASS = { status: "pass", summary: "done", artifacts: {} };
const resumed = flag("--resume") !== undefined;

if (env.FAKE_OMP_SCRIPT !== undefined) {
  for (const step of JSON.parse(env.FAKE_OMP_SCRIPT)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
    if (step.calls === undefined) await finish(step.say);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
    else await call(...step.calls);
  }
  await finish("done");
} else if (scenario === "hang") {
  out({ type: "turn_start" });
  inTurn = true;
  await waitForever();
} else if (scenario === "spend") {
  for (let i = 0; i < 3; i += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request after another
    await turn({ stopReason: "toolUse" });
  }
  if (env.FAKE_SPENT_FILE !== undefined) writeFileSync(env.FAKE_SPENT_FILE, "");
  await waitForever();
} else if (scenario === "end:budget_limit") {
  await call({ tool: "bash", input: { command: "true" } });
  await finish("under the cap");
} else if (scenario === "try-denied") {
  const [shellRun] = await call({ tool: "bash", input: { command: "ls" } });
  await finish(shellRun.isError ? "shell was refused" : "shell ran");
} else if (scenario === "wait-message") {
  if (!resumed) {
    await new Promise(resolve => setTimeout(resolve, 300));
    await finish("first leg");
  }
  await finish(`got: ${brief.trimStart()}`);
} else if (scenario === "extract") {
  const [read] = await call({ ork: "extract", input: { steps: [{ step: "read", path: ".endpoint" }] } });
  await finish(read.text);
} else if (scenario === "report-tool") {
  await call({ ork: "report", input: { status: "maybe", summary: 3 } });
  const [reported] = await call({ ork: "report", input: PASS });
  await finish(reported.isError ? "report refused" : "reported");
}

if (!resumed) {
  await call({ ork: "ask_user", input: { question: "Which way?", options: [{ id: "a" }, { id: "b" }], recommended: "a" } });
}
const [reported] = await call({ ork: "report", input: scenario === "invalid-report" ? { status: "maybe" } : PASS });
await finish(reported.isError ? `report refused: ${reported.text}` : "reported");
