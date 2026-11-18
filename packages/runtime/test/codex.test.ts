/**
 * @file The `codex` adapter beyond the contract suite: its decoder, on the line
 *   shapes RFC-024's spike measured (the session id, assistant text, tool calls
 *   and results in Claude Code's words, tokens-only usage, and how a leg ends);
 *   each leg's arguments (the flags always and never passed, the sandbox,
 *   resume and fork, instructions on the first leg only); the wiring (Ork's MCP
 *   keys, the token in the environment only, the hook removed after the
 *   session, a user or system hooks file refusing the session); the canary that
 *   ends a leg whose tools ran without the hook; and whole sessions on the fake
 *   `codex` (resume and fork legs, the token in the environment only, the hook
 *   removed after a failure, a refused call surfaced, a leg killed when the
 *   canary trips).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HumanChannel, RuntimeEvent, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  codexDecoder,
  codexTurnUsage,
  codexUsage,
} from "../src/adapters/codex-events.ts";
import {
  CODEX_TOKEN_VAR,
  codexArgs,
  codexSandbox,
  createCodexAdapter,
  createSessionRuntime,
  HOOK_DID_NOT_RUN,
} from "../src/index.ts";
import {
  collect,
  collectActing,
  outcomeOf,
  resultsOf,
} from "./contract/harness.ts";

const spec: SessionSpec = {
  nodeId: "cx",
  cwd: "/work",
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const line = (value: Record<string, unknown>): string => JSON.stringify(value);

const USAGE = {
  input_tokens: 1200,
  cached_input_tokens: 1000,
  cache_write_input_tokens: 50,
  output_tokens: 80,
  reasoning_output_tokens: 30,
};

/** One leg as the spike saw it: a shell command, a patch, Ork's report. */
const LEG = [
  line({ type: "thread.started", thread_id: "th-1" }),
  line({ type: "turn.started" }),
  line({
    type: "item.started",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "bash -lc ls",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  }),
  line({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "bash -lc ls",
      aggregated_output: "a.txt\n",
      exit_code: 0,
      status: "completed",
    },
  }),
  line({
    type: "item.completed",
    item: {
      id: "item_1",
      type: "file_change",
      changes: [{ path: "/work/b.txt", kind: "add" }],
      status: "completed",
    },
  }),
  line({
    type: "item.completed",
    item: {
      id: "item_2",
      type: "mcp_tool_call",
      server: "ork",
      tool: "report",
      arguments: { summary: "done" },
      result: { content: [{ type: "text", text: "ok" }] },
      error: null,
      status: "completed",
    },
  }),
  line({
    type: "item.completed",
    item: { id: "item_3", type: "agent_message", text: "All done." },
  }),
  line({ type: "turn.completed", usage: USAGE }),
];

const decodeAll = (
  lines: string[],
  code: number | null,
): { events: RuntimeEvent[]; ranTools: boolean } => {
  const decoder = codexDecoder(spec);
  const events = lines.flatMap(each => decoder.decode(each).events);
  return {
    events: [...events, ...decoder.exit(code)],
    ranTools: decoder.toolsRan(),
  };
};

const finished = (events: RuntimeEvent[]) =>
  events.flatMap(event =>
    event.type === "session.finished" ? [event.outcome] : [],
  );

describe("the codex decoder", () => {
  it("reads the session id, the text and the tool calls in Claude Code's words", () => {
    const { events, ranTools } = decodeAll(LEG, 0);
    expect(events.slice(0, -1)).toEqual([
      {
        type: "session.started",
        sessionId: "th-1",
        model: "default",
        cwd: "/work",
      },
      {
        type: "tool.called",
        id: "item_0",
        name: "Bash",
        input: { command: "bash -lc ls" },
      },
      { type: "tool.result", id: "item_0", isError: false },
      {
        type: "tool.called",
        id: "item_1",
        name: "Edit",
        input: { changes: [{ path: "/work/b.txt", kind: "add" }] },
      },
      { type: "tool.result", id: "item_1", isError: false },
      {
        type: "tool.called",
        id: "item_2",
        name: "mcp__ork__report",
        input: { summary: "done" },
      },
      { type: "tool.result", id: "item_2", isError: false },
      { type: "assistant.text", text: "All done." },
    ]);
    expect(ranTools).toBe(true);
  });

  it("ends a clean exit with no report, success and the leg's tokens", () => {
    const [outcome] = finished(decodeAll(LEG, 0).events);
    expect(outcome).toMatchObject({
      subtype: "success",
      end: { kind: "no_report" },
      sessionId: "th-1",
      report: null,
      text: "All done.",
      errors: [],
      usage: {
        costUsd: 0,
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 1000,
        cacheWriteTokens: 50,
        turns: 1,
      },
    });
  });

  it("gives the usage so far at a turn's end, so a token budget stops between legs", () => {
    const decoder = codexDecoder(spec);
    expect(
      decoder.decode(line({ type: "turn.completed", usage: USAGE })).usage,
    ).toMatchObject({
      inputTokens: 200,
      turns: 1,
    });
  });

  it("marks a failed command, and an Ork tool's bad-arguments answer", () => {
    const { events } = decodeAll(
      [
        line({
          type: "item.completed",
          item: {
            id: "c",
            type: "command_execution",
            command: "false",
            exit_code: 1,
            status: "failed",
          },
        }),
        line({
          type: "item.completed",
          item: {
            id: "m",
            type: "mcp_tool_call",
            server: "ork",
            tool: "report",
            arguments: {},
            result: {
              content: [
                {
                  type: "text",
                  text: "Invalid arguments, nothing ran: summary",
                },
              ],
            },
            error: null,
            status: "completed",
          },
        }),
      ],
      0,
    );
    expect(events.filter(event => event.type === "tool.result")).toEqual([
      { type: "tool.result", id: "c", isError: true },
      { type: "tool.result", id: "m", isError: true, fault: "arguments" },
    ]);
  });

  it("says no tool ran in a leg of text alone", () => {
    expect(
      decodeAll(
        LEG.filter(each => !each.includes("item_")),
        0,
      ).ranTools,
    ).toBe(false);
  });

  it("starts a fork's leg with the new id its thread.started prints", () => {
    const { events } = decodeAll(
      [
        line({ type: "thread.started", thread_id: "th-fork" }),
        line({ type: "turn.completed", usage: USAGE }),
      ],
      0,
    );
    expect(finished(events)[0]?.sessionId).toBe("th-fork");
  });

  it("ends a model the account refuses as model_unavailable", () => {
    const refused =
      "The 'gpt-x' model is not supported when using Codex with a ChatGPT account.";
    const [outcome] = finished(
      decodeAll(
        [
          line({ type: "thread.started", thread_id: "th-2" }),
          line({ type: "turn.started" }),
          line({ type: "error", message: refused }),
          line({ type: "turn.failed", error: { message: refused } }),
        ],
        1,
      ).events,
    );
    expect(outcome).toMatchObject({
      subtype: "error_during_execution",
      end: { kind: "model_unavailable" },
      errors: [refused],
    });
  });

  it("keeps a warning on an error line out of a clean leg's end", () => {
    const warning = line({
      type: "error",
      message: "hook trust bypassed for this run",
    });
    const [outcome] = finished(decodeAll([warning, ...LEG], 0).events);
    expect(outcome).toMatchObject({
      subtype: "success",
      end: { kind: "no_report" },
      errors: [],
    });
  });

  it.each([
    "hooks trust bypassed for this run",
    "hook-trust bypass enabled for hooks",
  ])("leaves a failed exit with only the warning %j to stderr", message => {
    const warning = line({ type: "error", message });
    expect(finished(decodeAll([warning], 1).events)).toEqual([]);
  });

  it("ends an interrupted leg (exit 130) as interrupted", () => {
    const [outcome] = finished(decodeAll(LEG.slice(0, 3), 130).events);
    expect(outcome?.end?.kind).toBe("interrupted");
  });

  it("leaves a failed exit no line explains to stderr", () => {
    const warning = line({
      type: "error",
      message: "hook trust bypassed for this run",
    });
    expect(finished(decodeAll([warning], 1).events)).toEqual([]);
  });

  it("ends a failed exit with Codex's own error lines, without the bypass warning", () => {
    const [outcome] = finished(
      decodeAll(
        [
          line({ type: "error", message: "hook trust bypassed for this run" }),
          line({
            type: "error",
            message: "thread/start failed: no such thread",
          }),
        ],
        1,
      ).events,
    );
    expect(outcome).toMatchObject({
      subtype: "error_during_execution",
      end: { kind: "driver_crashed" },
      errors: ["thread/start failed: no such thread"],
    });
  });

  it("ends a failed exit by a provider error an error line names", () => {
    const limited = line({
      type: "error",
      message: "429 Too Many Requests: rate limit reached",
    });
    expect(finished(decodeAll([limited], 1).events)[0]?.end?.kind).toBe(
      "rate_limited",
    );
  });
});

describe("codex usage", () => {
  it("counts input without its cached part, never below zero, and no dollars", () => {
    expect(
      codexTurnUsage({
        input_tokens: 10,
        cached_input_tokens: 40,
        output_tokens: 3,
      }),
    ).toEqual({
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 3,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      turns: 1,
      durationMs: 0,
    });
  });

  it("combines two legs as one session", () => {
    const turn = codexTurnUsage(USAGE);
    expect(codexUsage.dollars).toBe(false);
    expect(codexUsage.combine(turn, turn)).toMatchObject({
      costUsd: 0,
      inputTokens: 400,
      outputTokens: 160,
      cacheReadTokens: 2000,
      cacheWriteTokens: 100,
      turns: 2,
    });
  });
});

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const legOf = (over: Partial<SessionSpec>): SessionSpec => ({
  ...spec,
  ...over,
});

/** Flags a Codex leg never passes. */
const NEVER = new Set([
  "-p",
  "--profile",
  "--ephemeral",
  "--trust",
  "--approve-for-me",
  "--skip-git-repo-check",
  "--dangerously-bypass-approvals-and-sandbox",
]);

/** The flags every leg passes, after `exec` and the session it continues. */
const ALWAYS = [
  "--json",
  "--ignore-user-config",
  "--ignore-rules",
  "--dangerously-bypass-hook-trust",
  "--disable",
  "plugins",
  "--disable",
  "apps",
  "--disable",
  "remote_plugin",
];

describe("the codex adapter's arguments", () => {
  it("starts a session with the clean flags, the sandbox, model, effort and instructions", () => {
    expect(
      codexArgs(
        legOf({
          model: "gpt-6.2-sol",
          effort: "high",
          tools: { allow: ["Bash"], deny: [] },
        }),
      ),
    ).toEqual([
      "exec",
      ...ALWAYS,
      "-c",
      'sandbox_mode="workspace-write"',
      "-m",
      "gpt-6.2-sol",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'developer_instructions="# Ork"',
      "Do the task",
    ]);
  });

  it("names no model and no effort when the node sets none, and maps max to xhigh", () => {
    expect(codexArgs(spec)).toEqual([
      "exec",
      ...ALWAYS,
      "-c",
      'sandbox_mode="read-only"',
      "-c",
      'developer_instructions="# Ork"',
      "Do the task",
    ]);
    expect(codexArgs(legOf({ effort: "max" }))).toContain(
      'model_reasoning_effort="xhigh"',
    );
  });

  it("resumes, or forks, a session with the message alone, its instructions kept", () => {
    expect(codexArgs(legOf({ resume: "th-1", prompt: "-more" }))).toEqual([
      "exec",
      "resume",
      "th-1",
      ...ALWAYS,
      "-c",
      'sandbox_mode="read-only"',
      " -more",
    ]);
    expect(
      codexArgs(legOf({ resume: "th-1", fork: true })).slice(0, 3),
    ).toEqual(["exec", "fork", "th-1"]);
  });

  it("never passes a profile, ephemeral sessions, trust or a wider sandbox", () => {
    const legs = [
      spec,
      legOf({ resume: "th-1" }),
      legOf({ resume: "th-1", fork: true }),
      legOf({ yolo: true }),
      legOf({ permissionMode: "acceptEdits" }),
    ].flatMap(each => codexArgs(each));
    expect(legs.filter(arg => NEVER.has(arg))).toEqual([]);
    expect(legs.join(" ")).not.toContain("danger-full-access");
    expect(legs.join(" ")).not.toContain("network_access");
  });

  it("chooses read-only for plan mode and nodes that can't act, workspace-write otherwise", () => {
    const bash = { allow: ["Bash(git:*)"], deny: [] };
    expect(
      [
        legOf({ permissionMode: "plan", tools: bash }),
        legOf({ tools: { allow: ["Read", "mcp__github"], deny: [] } }),
        legOf({ tools: bash }),
        legOf({ tools: { allow: ["Write"], deny: [] } }),
        legOf({ permissionMode: "acceptEdits" }),
        legOf({ yolo: true }),
        legOf({
          permissionMode: "acceptEdits",
          yolo: true,
          tools: { allow: ["Read"], deny: [], only: ["Read"] },
        }),
      ].map(each => codexSandbox(each)),
    ).toEqual([
      "read-only",
      "read-only",
      "workspace-write",
      "workspace-write",
      "workspace-write",
      "workspace-write",
      "read-only",
    ]);
  });

  it("chooses read-only for a node denied Edit and Write outright, whatever its allows or yolo say", () => {
    // What core's toolRules gives a readonly node: git status, Write and Edit denied.
    const readonly = {
      allow: ["Bash(git status)", "Bash(git status *)"],
      deny: ["Write", "Edit", "NotebookEdit", "Grep", "Glob"],
    };
    expect(
      [
        legOf({ tools: readonly }),
        legOf({ tools: readonly, yolo: true }),
        legOf({ tools: readonly, permissionMode: "acceptEdits" }),
        legOf({ tools: { allow: ["Bash"], deny: ["Edit(docs/**)"] } }),
        legOf({ tools: { allow: ["Bash"], deny: ["Edit"] } }),
      ].map(each => codexSandbox(each)),
    ).toEqual([
      "read-only",
      "read-only",
      "read-only",
      "workspace-write",
      "workspace-write",
    ]);
  });
});

const ENDPOINT = {
  url: "http://127.0.0.1:4567/mcp",
  token: "tok-ork-secret-42",
};

/** A codex adapter whose secrets and system hooks file are in `root`. */
const adapterIn = (root: string, systemHooks = path.join(root, "none.json")) =>
  createCodexAdapter({ secretRoot: root, systemHooks });

/** Wires a session; a refusal is a rejection, however `wire` throws. */
const wireOf = (
  adapter: ReturnType<typeof createCodexAdapter>,
  session: SessionSpec,
  env: Record<string, string>,
) =>
  Promise.resolve().then(() =>
    adapter.mcp.wire(session, ENDPOINT, {
      waiting: () => {
        // Codex's wiring never waits.
      },
      signal: new AbortController().signal,
      env,
    }),
  );

const sessionIn = (cwd: string): SessionSpec =>
  legOf({ cwd, tools: { allow: ["Bash(git:*)"], deny: [] } });

/** The hook script a leg's arguments name. */
const hookOf = (args: string[]): string =>
  /([^"'\\\s]+hook\.mjs)/u.exec(args.join(" "))?.[1] ?? "";

const filesIn = (dir: string): string[] =>
  readdirSync(dir).map(name => readFileSync(path.join(dir, name), "utf8"));

const decoderOf = (
  adapter: ReturnType<typeof createCodexAdapter>,
  leg: SessionSpec,
) => adapter.legDecoder?.(leg) ?? codexDecoder(leg);

describe("the codex adapter's wiring", () => {
  it("passes Ork's MCP keys and the hook by -c, the token only in the environment", async () => {
    const root = temp("ork-codex-root-");
    const wired = await wireOf(
      adapterIn(root),
      sessionIn(temp("ork-codex-cwd-")),
      {
        CODEX_HOME: temp("ork-codex-home-"),
      },
    );
    const hook = hookOf(wired.args);
    expect(wired.args.slice(0, 10)).toEqual([
      "-c",
      'mcp_servers.ork.url="http://127.0.0.1:4567/mcp"',
      "-c",
      `mcp_servers.ork.bearer_token_env_var="${CODEX_TOKEN_VAR}"`,
      "-c",
      "mcp_servers.ork.tool_timeout_sec=86400",
      "-c",
      "mcp_servers.ork.required=true",
      "-c",
      'mcp_servers.ork.default_tools_approval_mode="approve"',
    ]);
    expect(wired.args.slice(10, 11)).toEqual(["-c"]);
    expect(wired.args[11]).toMatch(
      /^hooks\.PreToolUse=\[\{matcher = "\.\*", hooks = /u,
    );
    expect(wired.env).toEqual({ [CODEX_TOKEN_VAR]: ENDPOINT.token });
    expect(wired.args.join(" ")).not.toContain(ENDPOINT.token);
    expect(filesIn(path.dirname(hook)).join("\n")).not.toContain(
      ENDPOINT.token,
    );
    await wired.release();
    expect(existsSync(hook)).toBe(false);
  });

  it("refuses a session when the user's Codex home has a hooks file, before writing anything", async () => {
    const root = temp("ork-codex-root-");
    const home = temp("ork-codex-home-");
    writeFileSync(path.join(home, "hooks.json"), "{}");
    await expect(
      wireOf(adapterIn(root), sessionIn(temp("ork-codex-cwd-")), {
        CODEX_HOME: home,
      }),
    ).rejects.toThrow(`${path.join(home, "hooks.json")} exists`);
    expect(readdirSync(root)).toEqual([]);
  });

  it("looks in ~/.codex when CODEX_HOME is unset, and at the system's hooks file", async () => {
    const home = temp("ork-codex-user-");
    const user = path.join(home, ".codex", "hooks.json");
    mkdirSync(path.dirname(user));
    writeFileSync(user, "{}");
    await expect(
      wireOf(
        adapterIn(temp("ork-codex-root-")),
        sessionIn(temp("ork-codex-cwd-")),
        {
          HOME: home,
        },
      ),
    ).rejects.toThrow(`${user} exists`);
    const root = temp("ork-codex-root-");
    const system = path.join(root, "system-hooks.json");
    writeFileSync(system, "{}");
    await expect(
      wireOf(adapterIn(root, system), sessionIn(temp("ork-codex-cwd-")), {
        HOME: temp("ork-codex-user-"),
      }),
    ).rejects.toThrow(`${system} exists`);
  });

  it("reads an empty CODEX_HOME as unset, so ~/.codex is checked", async () => {
    const home = temp("ork-codex-user-");
    const user = path.join(home, ".codex", "hooks.json");
    mkdirSync(path.dirname(user));
    writeFileSync(user, "{}");
    await expect(
      wireOf(
        adapterIn(temp("ork-codex-root-")),
        sessionIn(temp("ork-codex-cwd-")),
        { HOME: home, CODEX_HOME: "" },
      ),
    ).rejects.toThrow(`${user} exists`);
  });
});

const FAKE = fileURLToPath(new URL("fixtures/fake-codex.mjs", import.meta.url));

const LegSchema = z.object({
  cwd: z.string(),
  args: z.array(z.string()),
  token: z.string().optional(),
  pid: z.number(),
});

/** Whether the process `pid` still runs. */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid of a session's only leg, once the fake has recorded it. */
const pidOf = (legs: () => z.infer<typeof LegSchema>[]): number =>
  legs()[0]?.pid ?? -1;

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "not in this run" }),
};

/**
 * A session on the fake `codex` playing `scenario`: its hook folders go in
 * `root`, and each leg's folder, arguments and token are recorded.
 */
const played = (
  scenario: string,
  over: Partial<SessionSpec> = {},
  env: Record<string, string> = {},
) => {
  const root = temp("ork-codex-root-");
  const cwd = temp("ork-codex-cwd-");
  const record = path.join(temp("ork-codex-record-"), "legs.jsonl");
  const session = createSessionRuntime(adapterIn(root), {
    bin: FAKE,
    env: {
      ...process.env,
      HOME: temp("ork-codex-user-"),
      CODEX_HOME: temp("ork-codex-home-"),
      FAKE_SCENARIO: scenario,
      FAKE_CODEX_RECORD: record,
      ...env,
    },
  }).start({ ...sessionIn(cwd), ...over }, { human });
  const legs = () =>
    readFileSync(record, "utf8")
      .split("\n")
      .filter(each => each !== "")
      .map(each => LegSchema.parse(JSON.parse(each)));
  return { session, root, cwd, legs, record };
};

/** The leg's arguments that start with `prefix`; none for no leg. */
const keysOf = (
  leg: z.infer<typeof LegSchema> | undefined,
  prefix: string,
): string[] => (leg?.args ?? []).filter(arg => arg.startsWith(prefix));

const endOf = (events: RuntimeEvent[]) =>
  events.find(event => event.type === "session.finished");

describe("a codex session on the fake codex", () => {
  it("resumes for a message sent mid-leg, passing the sandbox, MCP and hook keys again", async () => {
    const { session, cwd, legs, root } = played("wait-message");
    const events = await collectActing(session, () => {
      session.send("Also add tests");
    });
    expect(outcomeOf(events).text).toContain("got: Also add tests");
    const [first, second] = legs();
    expect(second?.args.slice(0, 3)).toEqual(["exec", "resume", "th-fake-1"]);
    expect(
      [first, second].map(leg => [
        leg?.cwd,
        keysOf(leg, "sandbox_mode=").length,
        keysOf(leg, "mcp_servers.ork.").length,
        keysOf(leg, "hooks.PreToolUse=").length,
        keysOf(leg, "developer_instructions=").length,
        leg?.args.includes("--dangerously-bypass-hook-trust"),
      ]),
    ).toEqual([
      [cwd, 1, 5, 1, 1, true],
      [cwd, 1, 5, 1, 0, true],
    ]);
    expect(readdirSync(root)).toEqual([]);
  });

  it("gives each leg Ork's token in its environment, never on its command line", async () => {
    const { session, legs } = played("plain");
    expect(outcomeOf(await collect(session)).report).toMatchObject({
      status: "pass",
    });
    const [leg] = legs();
    expect(leg?.token).toMatch(/^\S{16,}$/u);
    expect(leg?.args.join(" ")).not.toContain(leg?.token);
  });

  it("forks a session by exec fork, and carries on as the new thread", async () => {
    const { session, legs } = played("plain", { resume: "th-1", fork: true });
    const outcome = outcomeOf(await collect(session));
    expect(outcome.sessionId).toBe("fork-of-th-1");
    expect(legs()[0]?.args.slice(0, 3)).toEqual(["exec", "fork", "th-1"]);
    expect(keysOf(legs()[0], "developer_instructions=")).toEqual([]);
  });

  it("removes the hook after a session that failed", async () => {
    const { session, root } = played("end:auth");
    expect(outcomeOf(await collect(session)).end?.kind).toBe("auth");
    expect(readdirSync(root)).toEqual([]);
  });

  it("runs a patch through the hook and surfaces the shell call it refused", async () => {
    const { session, cwd } = played("edit", {
      tools: { allow: ["Edit"], deny: [] },
    });
    const events = await collect(session);
    expect(outcomeOf(events).text).toBe("patch ran, shell refused");
    expect(resultsOf(events, "Edit")).toEqual([false]);
    expect(resultsOf(events, "Bash")).toEqual([true]);
    expect(existsSync(path.join(cwd, "b.txt"))).toBe(true);
  });

  it("ends with a driver error when Codex ran tools its hook never saw", async () => {
    const { session } = played("plain", {}, { FAKE_CODEX_NO_HOOK: "1" });
    const end = endOf(await collect(session));
    expect(end).toMatchObject({
      outcome: {
        subtype: "error_driver",
        end: { kind: "driver_crashed" },
        errors: [HOOK_DID_NOT_RUN],
      },
    });
  });

  it("kills the leg at the canary's trip, and yields nothing after its end", async () => {
    const { session, cwd, legs } = played(
      "two-shells",
      { tools: { allow: ["Bash"], deny: [] } },
      { FAKE_CODEX_NO_HOOK: "1" },
    );
    const events = await collect(session);
    expect(events.at(-1)).toMatchObject({
      type: "session.finished",
      outcome: { end: { kind: "driver_crashed" }, errors: [HOOK_DID_NOT_RUN] },
    });
    expect(resultsOf(events, "Bash")).toEqual([false]);
    // The fake waits two seconds before its second shell call.
    await vi.waitFor(
      () => {
        expect(isAlive(pidOf(legs))).toBe(false);
      },
      { timeout: 1500 },
    );
    expect(existsSync(path.join(cwd, "late.txt"))).toBe(false);
  });

  it("refuses to start when the user's Codex home has a hooks file", async () => {
    const home = temp("ork-codex-home-");
    writeFileSync(path.join(home, "hooks.json"), "{}");
    const { session, root, record } = played("plain", {}, { CODEX_HOME: home });
    const outcome = outcomeOf(await collect(session));
    expect(outcome.subtype).toBe("error_driver");
    expect(outcome.errors.join("\n")).toContain("hooks.json exists");
    expect(readdirSync(root)).toEqual([]);
    // No leg spawned: the fake records every leg it starts.
    expect(existsSync(record)).toBe(false);
  });
});

describe("the codex hook canary", () => {
  it("ends a leg whose tool calls the hook never saw with a driver error", async () => {
    const adapter = adapterIn(temp("ork-codex-root-"));
    const session = sessionIn(temp("ork-codex-cwd-"));
    const wired = await wireOf(adapter, session, {
      CODEX_HOME: temp("ork-codex-home-"),
    });
    // A later leg is a copy of the session's spec, as the runner makes it.
    const decoder = decoderOf(adapter, { ...session, resume: "th-1" });
    const [outcome] = finished(
      LEG.flatMap(each => decoder.decode(each).events),
    );
    expect(outcome).toMatchObject({
      subtype: "error_driver",
      end: { kind: "driver_crashed" },
      sessionId: "th-1",
      errors: [HOOK_DID_NOT_RUN],
    });
    await wired.release();
  });

  it("asks the runner to kill the leg at the trip, and decodes nothing after", async () => {
    const adapter = adapterIn(temp("ork-codex-root-"));
    const session = sessionIn(temp("ork-codex-cwd-"));
    const wired = await wireOf(adapter, session, {
      CODEX_HOME: temp("ork-codex-home-"),
    });
    const decoder = decoderOf(adapter, session);
    const decoded = LEG.map(each => decoder.decode(each));
    // The shell command's `item.completed` (the fourth line) trips it.
    expect(decoded.map(each => each.kill === true)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(decoded.slice(4).flatMap(each => each.events)).toEqual([]);
    expect(decoder.exit(0)).toEqual([]);
    await wired.release();
  });

  it("lets a leg through when its hook saw its calls", async () => {
    const adapter = adapterIn(temp("ork-codex-root-"));
    const session = sessionIn(temp("ork-codex-cwd-"));
    const wired = await wireOf(adapter, session, {
      CODEX_HOME: temp("ork-codex-home-"),
    });
    const decoder = decoderOf(adapter, session);
    appendFileSync(
      path.join(path.dirname(hookOf(wired.args)), "calls.jsonl"),
      '{"tool":"Bash","refused":false}\n',
    );
    const events = LEG.flatMap(each => decoder.decode(each).events);
    expect(finished(events)).toEqual([]);
    expect(finished(decoder.exit(0))[0]?.end?.kind).toBe("no_report");
    await wired.release();
  });
});
