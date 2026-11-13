#!/usr/bin/env node
/**
 * @file A stand-in for `opencode run --format json` (2.1.0), for the
 *   `open-code` driver's tests. `--version` prints `2.1.0` and exits before any
 *   config is read, as `ork doctor` probes it. It reads its config from the file
 *   `OPENCODE_CONFIG` names: Ork's endpoint (`mcp.servers.ork`) and the
 *   permission rules, which it applies as OpenCode does (the last matching
 *   rule wins, `*` matches anything, and a call no rule matches runs, so only
 *   the adapter's leading deny-all refuses it). It prints `{type, timestamp, sessionID, part}` lines
 *   (`step_start`, `text`, `tool_use`, `step_finish`), the shapes in the real
 *   CLI's source, and no result line: it just exits. The message is its last
 *   argument; `--session <id>` continues a session (`--fork` makes it
 *   `fork-of-<id>`). `FAKE_OPENCODE_RECORD` gets what it was started with (its
 *   folder, arguments, config and the environment that keeps the machine's
 *   setup out), so tests can assert them; without `--standalone` it records
 *   the home folder as its folder, as the background service would run there. It follows fake-claude.mjs's
 *   protocol: `FAKE_ENDPOINT_FILE` gets the URL of Ork's endpoint, and
 *   `FAKE_SCENARIO` plays one case: unset (asks through `ork_ask_user`, then
 *   reports through `ork_report`), `invalid-report`, `try-denied` (a `shell`
 *   call, run unless a rule refuses it), `wait-message` (a slow first leg;
 *   a continued one ends with `got: <the message>`), `hang` (starts and waits
 *   for SIGINT, then exits 130 as the real one does), `spend` (three
 *   `step_finish` lines, then waits as `hang` does), `report-tool` (an
 *   `ork_report` outside the schema, then one inside, and nothing else) and
 *   `fail` (an `error` line, exit 1). `end:<kind>` ends the session the way
 *   OpenCode says that cause: `end:turn_limit` uses every step the `ork`
 *   agent's `steps` allows and reports nothing; the others print the `error`
 *   line OpenCode gives (`ENDS`) and exit 1.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (args[0] === "--version") {
  process.stdout.write("2.1.0\n");
  process.exit(0);
}
const config = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
const ork = config.mcp.servers.ork;
const rules = config.permissions ?? [];
const message = args.at(-1);
const resumed = flag("--session");
const session = resumed === undefined ? "ses_fake1" : args.includes("--fork") ? `fork-of-${resumed}` : resumed;
const scenario = process.env.FAKE_SCENARIO ?? "";
// `spend` marks, in FAKE_SPENT_FILE, that its usage lines are written.
const spent = () => {
  if (process.env.FAKE_SPENT_FILE !== undefined) writeFileSync(process.env.FAKE_SPENT_FILE, "");
};

if (process.env.FAKE_OPENCODE_RECORD !== undefined) {
  writeFileSync(
    process.env.FAKE_OPENCODE_RECORD,
    JSON.stringify({
      cwd: args.includes("--standalone") ? process.cwd() : homedir(),
      args,
      config,
      configFile: process.env.OPENCODE_CONFIG,
      env: {
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        OPENCODE_DISABLE_PROJECT_CONFIG: process.env.OPENCODE_DISABLE_PROJECT_CONFIG,
      },
    }),
  );
}
if (process.env.FAKE_ENDPOINT_FILE !== undefined) writeFileSync(process.env.FAKE_ENDPOINT_FILE, ork.url);

const line = (type, part) =>
  process.stdout.write(`${JSON.stringify({ type, timestamp: Date.now(), sessionID: session, ...part })}\n`);
const glob = pattern =>
  new RegExp(`^${pattern.split("*").map(s => s.replaceAll(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*")}$`, "su");
/** OpenCode's evaluation: the last matching rule wins; with none, the call runs. */
const allowed = (action, resource) =>
  [{ action: "*", resource: "*", effect: "allow" }, ...rules].findLast(r => glob(r.action).test(action) && glob(r.resource).test(resource))?.effect === "allow";

const rpc = async (method, params) => {
  const response = await fetch(ork.url, {
    method: "POST",
    headers: { ...ork.headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
};

let calls = 0;
/** One tool call, printed once it is done, as `run` prints it. */
const tool = async (name, input, run) => {
  calls += 1;
  const id = `call_${calls}`;
  const result = await run();
  line("tool_use", {
    part: {
      partID: `prt_${calls}`,
      type: "tool",
      id,
      tool: name,
      state: result.isError
        ? { status: "error", input, error: result.text }
        : { status: "completed", input, output: result.text, title: name },
    },
  });
  return result;
};

const refused = { isError: true, text: "This non-interactive run cannot ask the user for permission, so the request was rejected." };
const callOrk = (name, input) =>
  tool(`ork_${name}`, input, async () => {
    if (!allowed(`ork_${name}`, "*")) return refused;
    const reply = await rpc("tools/call", { name, arguments: input });
    const text = (reply.result?.content ?? []).map(c => c.text ?? "").join("") || (reply.error?.message ?? "");
    return { isError: reply.result?.isError === true || reply.error !== undefined, text };
  });

const text = said => line("text", { part: { type: "text", text: said } });
const step = () =>
  line("step_finish", {
    part: {
      type: "step-finish",
      reason: "stop",
      cost: 0.0123,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 80, write: 5 } },
    },
  });
const finish = said => {
  text(said);
  step();
  process.exit(0);
};

line("step_start", { part: { type: "step-start" } });

const apiError = (statusCode, type, said) => ({
  name: "APIError",
  data: {
    message: said,
    statusCode,
    isRetryable: statusCode >= 429,
    responseBody: JSON.stringify({ type: "error", error: { type, message: said } }),
  },
});
/** The `error` line OpenCode prints for each cause, for `end:<kind>`. */
const ENDS = {
  auth: { name: "ProviderAuthError", data: { providerID: "anthropic", message: "Invalid API key" } },
  out_of_credits: apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
  rate_limited: apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"),
  provider_unavailable: apiError(529, "overloaded_error", "Overloaded"),
  model_unavailable: apiError(
    400,
    "invalid_request_error",
    "This model does not support assistant message prefill. The conversation must end with a user message.",
  ),
};
if (scenario === "end:turn_limit") {
  for (let i = 0; i < (config.agents?.ork?.steps ?? 1); i += 1) step();
  text("I have reached the step limit.");
  process.exit(0);
} else if (scenario.startsWith("end:")) {
  line("error", { error: ENDS[scenario.slice(4)] });
  process.exit(1);
}

const PASS = { status: "pass", summary: "done", artifacts: {} };
if (scenario === "hang" || scenario === "spend") {
  process.on("SIGINT", () => process.exit(130));
  if (scenario === "spend") {
    for (let i = 0; i < 3; i += 1) step();
    spent();
  }
  await new Promise(() => setInterval(() => {}, 1000));
} else if (scenario === "fail") {
  line("error", { error: { name: "APIError", data: { message: "model not found" } } });
  process.exit(1);
} else if (scenario === "try-denied") {
  const ran = await tool("shell", { command: "ls" }, () =>
    allowed("shell", "ls") ? { isError: false, text: "ok" } : refused,
  );
  finish(ran.isError ? "shell was refused" : "shell ran");
} else if (scenario === "wait-message") {
  if (resumed === undefined) {
    await new Promise(resolve => setTimeout(resolve, 300));
    finish("first leg");
  }
  finish(`got: ${message}`);
} else if (scenario === "report-tool") {
  for (const report of [{ status: "maybe", summary: 3 }, PASS]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time
    const reply = await callOrk("report", report);
    text(reply.text);
  }
  step();
  process.exit(0);
}

text(`Working on: ${message}`);
const asked = await callOrk("ask_user", {
  question: "Which way?",
  options: [{ id: "a" }, { id: "b" }],
  recommended: "a",
});
text(`asked: ${asked.text}`);
step();
const reported = await callOrk("report", scenario === "invalid-report" ? { status: "maybe" } : PASS);
finish(reported.isError ? `report refused: ${reported.text}` : "reported");
