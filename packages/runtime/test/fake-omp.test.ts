/**
 * @file Tests that the fake `omp` (`fixtures/fake-omp.mjs`) behaves as `omp`
 *   18.22.2 did in RFC-026's capture legs and the task 1 hand check: its
 *   version, the exit codes of a bad start (2 for a flag, 1 before any line for
 *   an overlay or a guard), its answer to `set_host_tools`, the line shapes of
 *   a leg, Ork's host tools called by `host_tool_call` and run on the result
 *   (an `ork_` or `mcp__` name not offered is not found), a guard's `tool_call`
 *   handler awaited one call at a time with nothing printed while it waits, a
 *   refused call's lines, approval per tool name, the handler timeout, SIGINT
 *   while a call is held, a call refused as paused made again by the resumed
 *   leg, `--max-cost` over the whole session, resume and fork, all over `--mode
 *   rpc` (the brief as a `prompt` frame), and the record of each leg and call
 *   that task 9's sessions read.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const FAKE = fileURLToPath(new URL("fixtures/fake-omp.mjs", import.meta.url));

/** A line the fake prints or records, with the keys the tests read. */
const LineSchema = z.looseObject({
  type: z.string().optional(),
  kind: z.string().optional(),
  id: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  input: z.unknown().optional(),
  // A message's lines carry it as an object; a `notice`, as its words.
  message: z
    .union([z.string(), z.looseObject({ role: z.string().optional() })])
    .optional(),
});
type Line = z.infer<typeof LineSchema>;
const HostCallSchema = z.object({
  type: z.literal("host_tool_call"),
  id: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  arguments: z.looseObject({ status: z.unknown().optional() }).optional(),
});
type HostCall = z.infer<typeof HostCallSchema>;
type Leg = {
  status: Promise<number | null>;
  stdout: () => string;
  lines: () => Line[];
  stderr: () => string;
  signal: (name: NodeJS.Signals) => void;
  /** The host tool calls the leg made, each answered at once. */
  hostCalls: () => HostCall[];
};

/** The host tools a leg offers, as Ork names them to the model. */
const HOST_TOOLS = ["ork_ask_user", "ork_report", "ork_extract"];

/**
 * The host's answer to a host tool call: its name answered, an error for a
 * report that does not pass.
 */
const hostResult = (call: HostCall) => ({
  type: "host_tool_result",
  id: call.id,
  result: {
    content: [{ type: "text", text: `${call.toolName} answered` }],
    isError:
      call.toolName === "ork_report" && call.arguments?.status !== "pass",
  },
});

const OVERLAY = (timeoutMs: number): string =>
  [
    "# Ork's overlay",
    "tools:",
    "  xdev: false",
    "  approvalMode: always-ask",
    "  approval:",
    "    read: allow",
    "    bash: allow",
    "    edit: deny",
    "    write: deny",
    "    eval: deny",
    "    task: deny",
    "    ork_report: allow",
    "    ork_ask_user: allow",
    "extensionHandlers:",
    `  toolCallTimeoutMs: ${String(timeoutMs)}`,
    "prewalk:",
    '  auto: "off"',
    "",
  ].join("\n");

/**
 * A guard module: `body` runs inside its default export, with `pi`, `log` and
 * `wait`.
 */
const guardOf = (dir: string, body: string): string =>
  [
    'import { appendFileSync, existsSync } from "node:fs";',
    `const log = line => appendFileSync(${JSON.stringify(path.join(dir, "guard.log"))}, JSON.stringify(line) + "\\n");`,
    "const wait = file => new Promise(resolve => { const t = setInterval(() => { if (existsSync(file)) { clearInterval(t); resolve(); } }, 20); });",
    `const release = ${JSON.stringify(path.join(dir, "release"))};`,
    `export default pi => { ${body} };`,
  ].join("\n");

const ALLOW = `pi.on("tool_call", e => log({ asked: e.toolCallId, name: e.toolName, input: e.input })); pi.on("tool_result", e => log({ result: e.toolCallId, isError: e.isError }));`;

/**
 * A private folder (overlay, guard) like the adapter writes, in a new temporary
 * folder.
 */
const folder = (guard = ALLOW, timeoutMs = 7_260_000): string => {
  // The real path: the fake reports `process.cwd()`, which resolves macOS's /var link.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fake-omp-")));
  mkdirSync(path.join(dir, "secret"));
  writeFileSync(path.join(dir, "secret", "overlay.yml"), OVERLAY(timeoutMs));
  writeFileSync(path.join(dir, "secret", "guard.mjs"), guardOf(dir, guard));
  mkdirSync(path.join(dir, "work"));
  return dir;
};

const legArgs = (dir: string, extra: string[] = []): string[] => [
  "--mode",
  "rpc",
  "--no-skills",
  "--no-rules",
  "--offline",
  "--tools",
  "read,bash",
  "--thinking",
  "medium",
  "--append-system-prompt",
  "Ork's instructions",
  "--session-dir",
  path.join(dir, "sessions"),
  "--config",
  path.join(dir, "secret", "overlay.yml"),
  "--trusted-extension",
  path.join(dir, "secret", "guard.mjs"),
  ...extra,
];

/** The frames of the rpc protocol, apart from the session's own lines. */
const PROTOCOL = new Set([
  "ready",
  "response",
  "host_tool_call",
  "prompt_result",
  "session_settled",
]);

/** A frame Ork writes, as one line. */
const frame = (value: object): string => `${JSON.stringify(value)}\n`;

/**
 * Starts the fake in `dir/work`, with `script` (a list of requests) and extra
 * variables, offers it Ork's host tools and sends the brief as the `prompt`
 * frame, answers each host tool call, and closes its stdin once the session
 * settled, so it exits.
 */
const leg = (
  dir: string,
  args: string[],
  script?: unknown[],
  vars: Record<string, string> = {},
): Leg => {
  const child = spawn(FAKE, args, {
    cwd: path.join(dir, "work"),
    env: {
      ...process.env,
      FAKE_SCENARIO: "",
      FAKE_OMP_RECORD: path.join(dir, "record.jsonl"),
      ...(script === undefined
        ? {}
        : { FAKE_OMP_SCRIPT: JSON.stringify(script) }),
      ...vars,
    },
  });
  let stdout = "";
  let stderr = "";
  let read = 0;
  const hostCalls: HostCall[] = [];
  child.stdin.on("error", () => {
    // A leg that failed to start closed its stdin first.
  });
  const tools = HOST_TOOLS.map(name => ({
    name,
    description: name,
    parameters: { type: "object" },
  }));
  child.stdin.write(frame({ type: "set_host_tools", id: "h1", tools }));
  child.stdin.write(
    frame({ type: "prompt", id: "p1", message: "Do the task" }),
  );
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    const end = stdout.lastIndexOf("\n") + 1;
    // `--version` prints no JSON: only a line that is an object can be a call.
    const calls = stdout
      .slice(read, end)
      .split("\n")
      .filter(line => line.startsWith("{"))
      .flatMap(line => {
        const call = HostCallSchema.safeParse(JSON.parse(line));
        return call.success ? [call.data] : [];
      });
    read = end;
    for (const call of calls) {
      hostCalls.push(call);
      child.stdin.write(frame(hostResult(call)));
    }
    if (stdout.includes('"session_settled"')) child.stdin.end();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return {
    status: new Promise(resolve => {
      child.on("close", resolve);
    }),
    stdout: () => stdout,
    lines: () =>
      parseLines(stdout).filter(line => !PROTOCOL.has(line.type ?? "")),
    stderr: () => stderr,
    signal: name => {
      child.kill(name);
    },
    hostCalls: () => hostCalls,
  };
};

const parseLines = (text: string): Line[] =>
  text
    .split("\n")
    .filter(line => line !== "")
    .map(line => LineSchema.parse(JSON.parse(line)));
const jsonLines = (file: string): Line[] =>
  existsSync(file) ? parseLines(readFileSync(file, "utf8")) : [];
const recordOf = (dir: string, kind?: string): Line[] =>
  jsonLines(path.join(dir, "record.jsonl")).filter(
    line => kind === undefined || line.kind === kind,
  );
const guardLog = (dir: string): Line[] =>
  jsonLines(path.join(dir, "guard.log"));
const types = (lines: Line[]): string[] => lines.map(line => line.type ?? "");
/** The `message_end` lines of assistant messages. */
const assistantEnds = (lines: Line[]): Line[] =>
  lines.filter(
    line =>
      line.type === "message_end" &&
      typeof line.message === "object" &&
      line.message.role === "assistant",
  );
const ends = (lines: Line[]): Line[] =>
  lines.filter(line => line.type === "tool_execution_end");
const sessionOf = (lines: Line[]): Line | undefined =>
  lines.find(line => line.type === "session");

/** The fake's response to the leg's `set_host_tools` (`h1`). */
const reply = (child: Leg): Line | undefined =>
  parseLines(child.stdout()).find(line => line.id === "h1");

const BASH = (command: string) => ({ tool: "bash", input: { command } });
const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/** The arguments of a leg whose private `file` holds `text` instead. */
const spoil = (file: string, text: string) => (dir: string) => {
  writeFileSync(path.join(dir, "secret", file), text);
  return legArgs(dir);
};
/** The arguments of a leg that names a file that is not there. */
const rename = (from: string, to: string) => (dir: string) =>
  legArgs(dir).map(arg => arg.replace(from, to));

describe("the fake omp, starting", () => {
  it("prints its version as omp 18.22.2 does", async () => {
    const child = leg(folder(), ["--version"]);
    expect([await child.status, child.stdout()]).toEqual([0, "omp/18.22.2\n"]);
  });

  it("refuses an unknown flag, and -e beside --trusted-extension, with exit 2", async () => {
    const dir = folder();
    const unknown = leg(dir, legArgs(dir, ["--yolo"]));
    const both = leg(dir, legArgs(dir, ["-e", "x.mjs"]));
    expect([await unknown.status, unknown.stderr()]).toEqual([
      2,
      "Error: unknown flag: --yolo\n",
    ]);
    expect([await both.status, both.stderr()]).toEqual([
      2,
      "Error: --trusted-extension cannot be combined with --extension, -e, or --hook\n",
    ]);
  });

  it.each([
    [
      "an overlay that is not a mapping",
      spoil("overlay.yml", "x"),
      "Config overlay must be a YAML mapping",
    ],
    [
      "a missing overlay",
      rename("overlay.yml", "none.yml"),
      "Config overlay not found",
    ],
    [
      "a guard that throws",
      spoil("guard.mjs", 'throw new Error("no hold.json");'),
      "Trusted extension failed to load: Failed to load extension: no hold.json",
    ],
    [
      "a missing guard",
      rename("guard.mjs", "none.mjs"),
      "Trusted extension must be an existing module file",
    ],
  ])(
    "ends the leg before any line, exit 1, with %s",
    async (_, argsOf, words) => {
      const dir = folder();
      const child = leg(dir, argsOf(dir));
      expect([await child.status, child.lines()]).toEqual([1, []]);
      expect(child.stderr()).toContain(`error: ${words}`);
    },
  );

  it("answers set_host_tools with the tools' names, or an error under FAKE_OMP_HOST_TOOLS=refuse", async () => {
    const dir = folder();
    const offered = leg(dir, legArgs(dir));
    const refused = leg(dir, legArgs(dir), undefined, {
      FAKE_OMP_HOST_TOOLS: "refuse",
    });
    expect([await offered.status, await refused.status]).toEqual([0, 0]);
    expect(reply(offered)).toMatchObject({
      type: "response",
      success: true,
      data: { toolNames: HOST_TOOLS },
    });
    expect(reply(refused)).toMatchObject({
      type: "response",
      success: false,
      error: "host tools are not supported",
    });
  });
});

describe("the fake omp, a leg", () => {
  it("prints the recorded lines, calls Ork's host tools by their names, and ends with agent_end", async () => {
    const dir = folder();
    const child = leg(dir, legArgs(dir));
    expect(await child.status).toBe(0);
    const lines = child.lines();
    expect(types(lines).slice(0, 6)).toEqual([
      "session",
      "advisor_cost_changed",
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
    ]);
    expect(sessionOf(lines)).toMatchObject({
      version: 3,
      cwd: path.join(dir, "work"),
    });
    expect(sessionOf(lines)?.id).toMatch(/^fake-omp-/u);
    expect(lines.at(-1)).toMatchObject({
      type: "agent_end",
      isTerminal: true,
      yielded: false,
    });
    expect(
      lines
        .filter(line => line.type === "tool_execution_start")
        .map(line => line.toolName),
    ).toEqual(["ork_ask_user", "ork_report"]);
    expect(assistantEnds(lines)[0]).toMatchObject({
      message: {
        usage: {
          input: 100,
          output: 20,
          cacheRead: 80,
          cacheWrite: 5,
          totalTokens: 205,
          cost: { total: 0.001 },
        },
        stopReason: "toolUse",
        credentialId: 7,
        responseId: "resp_1",
      },
    });
    const starts = lines.filter(line => line.type === "tool_execution_start");
    expect(
      child.hostCalls().map(call => [call.toolName, call.toolCallId]),
    ).toEqual(starts.map(line => [line.toolName, line.toolCallId]));
    expect(ends(lines).map(line => line["result"])).toMatchObject([
      { content: [{ text: "ork_ask_user answered" }] },
      { content: [{ text: "ork_report answered" }] },
    ]);
  });

  it("finds no tool for an Ork name it was not offered, nor an MCP name", async () => {
    const dir = folder();
    const child = leg(dir, legArgs(dir), [
      { calls: [{ tool: "ork_nope" }, { tool: "mcp__ork__report" }] },
    ]);
    expect(await child.status).toBe(0);
    expect(ends(child.lines())).toMatchObject([
      {
        isError: true,
        result: { content: [{ text: 'Tool "ork_nope" not found' }] },
      },
      {
        isError: true,
        result: { content: [{ text: 'Tool "mcp__ork__report" not found' }] },
      },
    ]);
    expect(child.hostCalls()).toEqual([]);
  });

  it("records each leg's arguments and environment, and each call that ran", async () => {
    const dir = folder();
    await leg(dir, legArgs(dir), [{ calls: [BASH("echo hi > made.txt")] }], {
      MARK: "yes",
    }).status;
    const [first] = recordOf(dir, "leg");
    expect(first).toMatchObject({
      args: legArgs(dir),
      cwd: path.join(dir, "work"),
      env: { MARK: "yes" },
    });
    expect(
      recordOf(dir, "ran").map(line => [line["tool"], line.input]),
    ).toEqual([["bash", { command: "echo hi > made.txt" }]]);
    expect(readFileSync(path.join(dir, "work", "made.txt"), "utf8")).toBe(
      "hi\n",
    );
  });

  it("shows a call the guard refuses with its reason, and no tool_result event", async () => {
    const dir = folder(
      `pi.on("tool_call", e => e.input.command === "ls" ? { block: true, reason: "Ork: Bash(ls) is not allowed" } : undefined); pi.on("tool_result", e => log({ result: e.toolCallId }));`,
    );
    const child = leg(dir, legArgs(dir), [
      { calls: [BASH("ls"), BASH("true")] },
    ]);
    expect(await child.status).toBe(0);
    const [refused, ran] = ends(child.lines());
    expect(refused).toMatchObject({
      isError: true,
      result: {
        content: [{ type: "text", text: "Ork: Bash(ls) is not allowed" }],
      },
    });
    expect(ran).toMatchObject({ isError: false });
    expect(guardLog(dir)).toEqual([{ result: ran?.toolCallId }]);
    expect(recordOf(dir, "ran").map(line => line.input)).toEqual([
      { command: "true" },
    ]);
  });

  it("fails an Ork tool with no approval entry before the guard sees it", async () => {
    const dir = folder();
    const child = leg(dir, legArgs(dir), [
      { calls: [{ ork: "extract", input: {} }] },
    ]);
    expect(await child.status).toBe(0);
    expect(ends(child.lines())[0]).toMatchObject({
      isError: true,
      result: {
        content: [
          {
            text: 'Tool "ork_extract" requires approval but no interactive UI available',
          },
        ],
      },
    });
    expect(guardLog(dir)).toEqual([]);
  });

  it("fails a call whose handler outlasts toolCallTimeoutMs", async () => {
    const dir = folder(`pi.on("tool_call", () => new Promise(() => {}));`, 200);
    const child = leg(dir, legArgs(dir), [{ calls: [BASH("true")] }]);
    expect(await child.status).toBe(0);
    expect(ends(child.lines())[0]).toMatchObject({
      isError: true,
      result: {
        content: [
          { text: "Extension handler for tool_call timed out after 200ms" },
        ],
      },
    });
    expect(recordOf(dir, "ran")).toEqual([]);
  });
});

describe("the fake omp, holding a call", () => {
  const HOLD = `pi.on("tool_call", async e => { log({ asked: e.toolCallId }); await wait(release); log({ answered: e.toolCallId }); });`;

  it("prints nothing while the handler waits, then the message_end and the call", async () => {
    const dir = folder(HOLD);
    const child = leg(dir, legArgs(dir), [{ calls: [BASH("true")] }]);
    await vi.waitFor(() => {
      expect(guardLog(dir)).toHaveLength(1);
    });
    await sleep(100);
    expect(child.lines().at(-1)).toMatchObject({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end" },
    });
    expect(assistantEnds(child.lines())).toEqual([]);
    writeFileSync(path.join(dir, "release"), "");
    expect(await child.status).toBe(0);
    expect(recordOf(dir, "ran")).toHaveLength(1);
  });

  it("asks the calls of one message one at a time", async () => {
    const dir = folder(HOLD);
    writeFileSync(path.join(dir, "release"), "");
    await leg(dir, legArgs(dir), [{ calls: [BASH("true"), BASH("true")] }])
      .status;
    expect(guardLog(dir).map(line => Object.keys(line)[0])).toEqual([
      "asked",
      "answered",
      "asked",
      "answered",
    ]);
  });

  it("exits 130 on SIGINT while a call is held, and the call never runs", async () => {
    const dir = folder(HOLD);
    const child = leg(dir, legArgs(dir), [{ calls: [BASH("true")] }]);
    await vi.waitFor(() => {
      expect(guardLog(dir)).toHaveLength(1);
    });
    child.signal("SIGINT");
    expect(await child.status).toBe(130);
    expect(types(child.lines()).slice(-3)).toEqual([
      "message_start",
      "message_end",
      "turn_end",
    ]);
    expect(assistantEnds(child.lines()).at(-1)).toMatchObject({
      message: { stopReason: "aborted", content: [] },
    });
    expect(recordOf(dir, "ran")).toEqual([]);
  });

  it("makes a call refused as paused again in the resumed leg", async () => {
    const dir = folder(
      `pi.on("tool_call", () => existsSync(release) ? undefined : { block: true, reason: "Ork paused this node, so this call did not run. Do nothing else." });`,
    );
    const first = leg(dir, legArgs(dir), [{ calls: [BASH("true")] }]);
    expect(await first.status).toBe(0);
    writeFileSync(path.join(dir, "release"), "");
    const id = String(sessionOf(first.lines())?.id);
    const again = leg(dir, legArgs(dir, ["--resume", id]), [
      { calls: [BASH("true")] },
    ]);
    expect(await again.status).toBe(0);
    expect([
      recordOf(dir, "asked").length,
      recordOf(dir, "ran").length,
    ]).toEqual([2, 1]);
  });
});

describe("the fake omp, sessions", () => {
  it("counts --max-cost over the whole session, during a leg and at a resumed leg's start", async () => {
    const dir = folder();
    const first = leg(dir, legArgs(dir, ["--max-cost", "0.0015"]), [
      { calls: [BASH("true")] },
      { calls: [BASH("true")] },
      { calls: [BASH("true")] },
    ]);
    expect(await first.status).toBe(0);
    expect(first.stdout()).toContain('"code":"cost_cap"');
    expect(types(first.lines()).slice(-2)).toEqual(["notice", "agent_end"]);
    expect(first.lines().at(-2)).toMatchObject({
      level: "error",
      source: "cost-gate",
    });
    const id = String(sessionOf(first.lines())?.id);
    const again = leg(
      dir,
      legArgs(dir, ["--max-cost", "0.001", "--resume", id]),
    );
    expect(await again.status).toBe(0);
    expect(types(again.lines())).toEqual([
      "session",
      "advisor_cost_changed",
      "notice",
    ]);
  });

  it("resumes under the same id with only its own messages, and forks under a new id", async () => {
    const dir = folder();
    const first = leg(dir, legArgs(dir));
    await first.status;
    const id = String(sessionOf(first.lines())?.id);
    const resumed = leg(dir, legArgs(dir, ["--resume", id]));
    const forked = leg(dir, legArgs(dir, ["--fork", id]));
    expect([await resumed.status, await forked.status]).toEqual([0, 0]);
    expect(sessionOf(resumed.lines())).toMatchObject({ id });
    expect(
      resumed.lines().filter(line => line.type === "tool_execution_start"),
    ).toHaveLength(1);
    expect(sessionOf(forked.lines())).toMatchObject({ parentSession: id });
    expect(sessionOf(forked.lines())?.id).not.toBe(id);
  });

  it("ends a leg that resumes a session it does not know, exit 1", async () => {
    const dir = folder();
    const child = leg(dir, legArgs(dir, ["--resume", "nope"]));
    expect([await child.status, child.lines()]).toEqual([1, []]);
    expect(child.stderr()).toContain('Session "nope" not found');
  });
});
