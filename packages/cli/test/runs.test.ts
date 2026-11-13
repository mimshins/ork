/**
 * @file Tests for recorded runs: `ork run` writes to the store, `ork logs`
 *   replays the same transcript, `ork tree` and `ork ps` read it back, a
 *   workflow whose tool programs are missing does not start, and messages and
 *   owner questions read well in the transcript.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findRun,
  type HumanChannel,
  nestItems,
  openStore,
  type RunEvent,
  type RunRecord,
  runTree,
  type TreeNode,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import {
  ago,
  duration,
  followRun,
  formatEvent,
  formatRuns,
  formatRunEvent,
  formatTree,
  formatTreeView,
  runWorkflowFile,
  type RunWorkflowOptions,
} from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "nodes:",
  "  write:",
  "    type: agent.worker",
  "    isolation: shared",
  '    prompt: "Write the notes"',
  "  publish:",
  "    type: tool.shell",
  '    command: "echo done"',
  "  push:",
  "    type: tool.gh",
  '    command: "pr view"',
  "edges:",
  "  - write -> publish",
  "  - from: publish",
  "    to: push",
  "    when: exitCode == 1",
  "",
].join("\n");

/** The workflow without its `tool.gh` node. */
const WITHOUT_GH = [
  ...WORKFLOW.split("\n").slice(0, WORKFLOW.split("\n").indexOf("  push:")),
  "edges:",
  "  - write -> publish",
  "",
].join("\n");

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const setup = (overrides: Partial<RunWorkflowOptions> = {}) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-runs-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
  const out: string[] = [];
  const err: string[] = [];
  const store = openStore(":memory:");
  const value: RunWorkflowOptions = {
    file: "notes.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human: recommending,
    store,
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: line => {
      out.push(line);
    },
    err: line => {
      err.push(line);
    },
    tools: () => Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" }),
    installed: () => true,
    ...overrides,
  };
  return { dir, out, err, store, value };
};

/** Every line `ork logs` prints for the newest run in `dir`. */
const logLines = async (s: ReturnType<typeof setup>, node?: string) => {
  const found = findRun(s.store, undefined, s.dir);
  if (!found.ok) throw new Error(found.error);
  const lines: string[] = [];
  await followRun(
    s.store,
    found.run,
    line => {
      lines.push(line);
    },
    { follow: false, json: false, ...(node === undefined ? {} : { node }) },
  );
  return { run: found.run, lines };
};

/** A finished node that used 100 + 20 + 5 counted tokens and cost nothing. */
const spentNode = (id: string, extra: Partial<TreeNode>): TreeNode => ({
  id,
  type: "agent.worker",
  state: "ok",
  runs: 1,
  costUsd: 0,
  inputTokens: 100,
  outputTokens: 20,
  cacheWriteTokens: 5,
  children: [],
  ...extra,
});

/** A finished node, with a leader's description when one is given. */
const named = (id: string, description?: string): TreeNode =>
  spentNode(id, description === undefined ? {} : { description });

/** The code-point column where a tree line's node type starts. */
const typeColumn = (line = ""): number =>
  Array.from(line.slice(0, line.indexOf("agent.worker"))).length;

/** What `ork tree` prints for a run, as one text. */
const view = (run: RunRecord, events: RunEvent[]) =>
  formatTreeView(run, events, nestItems(runTree(events))).join("\n");

describe("a recorded run", () => {
  it("is in the store, and `ork logs` prints what `ork run` printed", async () => {
    const s = setup();
    const { exitCode, result } = await runWorkflowFile(s.value);
    expect(exitCode).toBe(0);
    const { run, lines } = await logLines(s);
    expect(run).toMatchObject({
      id: result?.runId,
      workflow: "notes",
      status: "succeeded",
      project: s.dir,
    });
    // The log cannot know a terminal was asking; the live run said so.
    expect(lines).toEqual(
      s.out.map(line =>
        line.replace("answer here or with ork decide", "ork decide"),
      ),
    );
    const publishOnly = await logLines(s, "publish");
    expect(publishOnly.lines.length).toBeGreaterThan(0);
    expect(publishOnly.lines.every(l => l.includes("publish"))).toBe(true);
  });

  it("draws the ownership tree and lists the run in `ork ps`", async () => {
    const s = setup();
    await runWorkflowFile(s.value);
    const { run } = await logLines(s);
    const roots = runTree(s.store.events(run.id).map(e => e.event));
    expect(roots.map(r => `${r.id} ${r.state}`)).toEqual([
      "write ok",
      "publish ok",
      "push skipped",
    ]);
    expect(formatTree(roots)).toHaveLength(3);
    const table = formatRuns(s.store.runs(), false);
    expect(table).toHaveLength(2);
    expect(table[1]).toContain("succeeded");
  });

  it("shows counted tokens, not `$0.00`, for a node whose driver reports no dollars", () => {
    const [priced, unpriced] = formatTree([
      spentNode("a", {}),
      spentNode("b", { unpriced: true }),
    ]);
    expect(priced).toContain("  125 tok · $0.00");
    expect(unpriced).toMatch(/ {2}125 tok$/u);
    expect(unpriced).not.toContain("$");
    expect(priced).not.toMatch(/ in \/ | out/u);
  });

  it("leaves a node's tokens blank in `ork tree` when it counted none", () => {
    const [line] = formatTree([
      spentNode("a", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
      }),
    ]);
    expect(line).not.toMatch(/tok|\$/u);
  });

  describe("a delegated task's description", () => {
    it("follows the id in the label column, aligning the rest", () => {
      const [first, second] = formatTree([
        named("a", "fix the parser"),
        named("bb"),
      ]);
      expect(first).toContain("a  fix the parser  agent.worker");
      expect(second).toContain("bb              ");
      expect(second?.indexOf("agent.worker")).toBe(
        first?.indexOf("agent.worker"),
      );
    });

    it("pads the label column by code points, so an emoji label aligns", () => {
      const [first, second] = formatTree([
        named("a", "ship it 🚀"),
        named("bb"),
      ]);
      expect(first).toContain("a  ship it 🚀  agent.worker");
      expect(typeColumn(second)).toBe(typeColumn(first));
    });

    it("masks a secret in a label: tree, node.started and the delegate call", () => {
      const label = "use ghp_abcdefghijklmnopqrstuvwxyz0123";
      expect(formatTree([named("a", label)])[0]).toContain("use [masked]");
      const started = formatRunEvent(
        {
          type: "node.started",
          id: "w",
          nodeType: "agent.worker",
          round: 1,
          description: label,
        },
        4,
        new Map(),
      ).join("");
      expect(started).toContain("· use [masked]");
      expect(started).not.toContain("ghp_");
      const call = formatEvent(
        "lead",
        {
          type: "tool.called",
          id: "t1",
          name: "mcp__ork__delegate",
          input: { tasks: [{ node: "w", description: label }] },
        },
        new Map(),
      ).join("");
      expect(call).toContain("use [masked]");
      expect(call).not.toContain("ghp_");
    });

    it("leaves a node without one exactly as before", () => {
      const [line] = formatTree([named("a")]);
      expect(line).toMatch(/^a {2}agent\.worker {2}/u);
    });

    it("is a field of `ork tree --json` when node.started has one", () => {
      const events: RunEvent[] = [
        {
          type: "node.started",
          id: "w",
          nodeType: "agent.worker",
          round: 1,
          description: "fix the parser",
        },
      ];
      expect(runTree(events).map(node => node.description)).toEqual([
        "fix the parser",
      ]);
    });
  });

  describe("`ork tree`'s view of a lock wait", () => {
    const live: RunRecord = {
      id: "r2",
      workflow: "issues",
      file: "/p/w.ork.yaml",
      project: "/p",
      status: "running",
      pid: process.pid,
      startedAt: "2026-11-10T11:00:00.000Z",
      costUsd: 0,
      depth: 0,
    };
    const started: RunEvent = {
      type: "run.started",
      runId: "r2",
      workflow: "issues",
      entries: [],
      nodes: [
        { id: "push", type: "tool.shell" },
        { id: "build", type: "tool.shell" },
      ],
    };
    const waiting = (id: string): RunEvent[] => [
      started,
      { type: "node.started", id, nodeType: "tool.shell", round: 1 },
      {
        type: "lock.waiting",
        id,
        lock: "branch:main",
        holders: ["r1/push"],
      },
    ];
    it("says in the header and the row that a live run waits", () => {
      const text = view(live, waiting("push"));
      expect(text).toContain("waiting for branch:main, held by r1/push");
      expect(text).toMatch(/push .*waiting for branch:main/u);
    });

    it("says neither once the lock is taken", () => {
      const events: RunEvent[] = [
        ...waiting("push"),
        { type: "lock.taken", id: "push", lock: "branch:main" },
      ];
      expect(view(live, events)).not.toContain("waiting for");
    });

    it("says neither for a finished run's stale wait", () => {
      const finished: RunRecord = { ...live, status: "failed" };
      expect(view(finished, waiting("push"))).not.toContain("waiting for");
    });

    it("shows an item's wait on its row under the fanned node", () => {
      const text = view(live, waiting("build.0"));
      expect(text).toMatch(/build\.0 .*waiting for branch:main/u);
    });
  });

  describe("`ork tree` after a crash", () => {
    // a ended, b was cut off mid-run, c never started.
    const events: RunEvent[] = [
      {
        type: "run.started",
        runId: "r3",
        workflow: "w",
        entries: ["a"],
        nodes: ["a", "b", "c"].map(id => ({ id, type: "tool.shell" })),
      },
      { type: "node.started", id: "a", nodeType: "tool.shell", round: 1 },
      { type: "node.finished", id: "a", round: 1, ok: true, output: {} },
      { type: "node.started", id: "b", nodeType: "tool.shell", round: 1 },
    ];
    const run: RunRecord = {
      id: "r3",
      workflow: "w",
      file: "/p/w.ork.yaml",
      project: "/p",
      status: "running",
      // A process that has exited: `ork ps` reads the run as crashed.
      pid: spawnSync("true").pid ?? 0,
      startedAt: "2026-11-10T11:00:00.000Z",
      costUsd: 0,
      depth: 0,
    };

    it("shows the cut-off node as cut off and the rest as not run", () => {
      const [header, a, b, c] = view(run, events).split("\n");
      expect(header).toContain("crashed");
      expect(a).toMatch(/^a .*✓/u);
      expect(b).toMatch(/^b .*✗ cut off$/u);
      expect(c).toMatch(/^c .*- not run$/u);
    });

    it("still shows a live run's node as running", () => {
      const text = view({ ...run, pid: process.pid }, events);
      expect(text).toMatch(/b .*● running/u);
      expect(text).not.toContain("cut off");
    });
  });

  it("does not start when a tool node's program is not installed", async () => {
    const s = setup({ installed: program => program !== "gh" });
    const { exitCode } = await runWorkflowFile(s.value);
    expect(exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("gh, for push (tool.gh)");
    expect(s.store.runs()).toEqual([]);
  });

  it("starts without the integrations the workflow does not use", async () => {
    const s = setup({
      installed: program => program === "echo",
    });
    writeFileSync(path.join(s.dir, "notes.ork.yaml"), WITHOUT_GH);
    expect((await runWorkflowFile(s.value)).exitCode).toBe(0);
  });
});

describe("run lookup and formatting", () => {
  it("finds a run by prefix and says when it is ambiguous or missing", () => {
    const store = openStore(":memory:");
    for (const id of ["aa11", "aa22"]) {
      store.begin({ id, workflow: "w", file: "/w", project: "/p" });
    }
    expect(findRun(store, "aa1", "/p")).toMatchObject({ ok: true });
    expect(findRun(store, "aa", "/p")).toEqual({
      ok: false,
      error: "`aa` matches 2 runs: aa22, aa11",
    });
    expect(findRun(store, "zz", "/p")).toEqual({
      ok: false,
      error: "No run `zz`.",
    });
  });

  it("shows a called run's cost as its caller's, not as more spend", () => {
    const store = openStore(":memory:");
    store.begin({ id: "caller11", workflow: "w", file: "/w", project: "/p" });
    store.begin({
      id: "called22",
      workflow: "fix",
      file: "/fix",
      project: "/p",
      parent: "caller11",
    });
    const [, ...rows] = formatRuns(store.runs(), false);
    expect(rows.find(line => line.startsWith("called22"))).toMatch(
      /\$0\.00 in caller11$/u,
    );
    expect(rows.find(line => line.startsWith("caller11"))).not.toContain(
      " in ",
    );
  });

  it("says how long ago and for how long", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    expect(
      [
        "2026-10-30T11:59:40Z",
        "2026-10-30T11:10:00Z",
        "2026-10-29T09:00:00Z",
        "2026-09-01T00:00:00Z",
      ].map(t => ago(t, now)),
    ).toEqual(["just now", "50m ago", "1d ago", "2026-09-01"]);
    expect([42_000, 192_000, 3_900_000].map(ms => duration(ms))).toEqual([
      "42s",
      "3m12s",
      "1h05m",
    ]);
  });

  it("ends a run's output with what it skipped, which failures it handled, and unread mail", () => {
    const [, last, warning] = formatRunEvent(
      {
        type: "run.finished",
        result: {
          runId: "r1",
          status: "succeeded",
          costUsd: 0,
          nodes: [
            { id: "a", runs: 1, ok: false, output: null, costUsd: 0 },
            { id: "cleanup", runs: 1, ok: true, output: null, costUsd: 0 },
            { id: "ship", runs: 0, ok: null, output: null, costUsd: 0 },
          ],
          reasons: [],
          worktrees: [],
          skipped: 1,
          failuresHandled: 1,
          unread: [{ node: "ship", messages: 2 }],
        },
      },
      4,
      new Map(),
    );
    expect(last).toContain(
      "run r1 succeeded · $0.00 · 2 ran, 1 skipped, 1 failure handled",
    );
    expect(warning).toContain(
      "warning ship never ran, so 2 messages to it went unread",
    );
  });

  it("counts what a resume kept apart from what ran", () => {
    const [, last] = formatRunEvent(
      {
        type: "run.finished",
        result: {
          runId: "r1",
          status: "succeeded",
          costUsd: 0,
          nodes: [
            { id: "a", runs: 1, ok: true, output: null, costUsd: 0 },
            { id: "b", runs: 1, ok: true, output: null, costUsd: 0 },
          ],
          reasons: [],
          worktrees: [],
          skipped: 0,
          kept: 1,
          failuresHandled: 0,
        },
      },
      4,
      new Map(),
    );
    expect(last).toContain("run r1 succeeded · $0.00 · 1 ran, 1 kept");
  });

  it("says how a message came when no session wrote it", () => {
    const lines = (
      [
        {
          type: "message.received",
          node: "lead",
          from: "check",
          message: 1,
          body: "tests failed",
          via: "script",
        },
        {
          type: "message.sent",
          node: "check",
          to: "lead",
          message: 2,
          body: "check exited 1",
          via: "rule",
        },
      ] as const
    ).flatMap(event => formatRunEvent(event, 4, new Map()));
    expect(lines.join("\n")).toContain("from check (script): tests failed");
    expect(lines.join("\n")).toContain("to lead (rule): check exited 1");
  });

  it("prints messages, owner questions and claims with their node", () => {
    const lines = (
      [
        {
          type: "message.sent",
          node: "docs",
          to: "code",
          message: 1,
          body: "API renamed\nsee docs/api.md",
        },
        { type: "message.read", node: "code", ids: [1] },
        {
          type: "owner.asked",
          node: "lead",
          about: "fix",
          question: "q1",
          text: "Again?",
          options: [{ id: "stop" }],
        },
        {
          type: "owner.answered",
          node: "lead",
          question: "q1",
          answer: "stop",
        },
        { type: "owner.unanswered", node: "lead", question: "q2" },
        {
          type: "user.message",
          node: "fix",
          body: "tabs",
          delivered: "queued",
        },
        { type: "claim.taken", node: "api", resource: "src" },
        {
          type: "claim.refused",
          node: "ui",
          resource: "src/a.ts",
          holder: "api",
          held: "src",
        },
        {
          type: "claim.released",
          node: "api",
          resource: "src",
          reason: "finished",
        },
      ] satisfies RunEvent[]
    ).flatMap(event => formatRunEvent(event, 4, new Map()));
    expect(lines).toEqual([
      "docs │ ✉ to code: API renamed",
      "lead │ ? asked as the owner of fix: Again? (q1)",
      "lead │ → stop (owner)",
      "lead │ → its session ended first; asking you",
      "fix  │ you: tabs (for its next session)",
      "api  │ ⚑ claimed src",
      "ui   │ ⚑ src/a.ts is api's (it holds src)",
      "api  │ ⚑ released src",
    ]);
  });

  it("marks a leader's fork's lines as the fork's", () => {
    const lines = (
      [
        {
          type: "node.event",
          id: "lead",
          event: {
            type: "session.started",
            sessionId: "f1",
            model: "opus",
            fork: true,
          },
        },
        {
          type: "node.event",
          id: "lead",
          event: { type: "assistant.text", text: "b.", fork: true },
        },
        {
          type: "node.event",
          id: "lead",
          event: { type: "assistant.text", text: "Delegating." },
        },
      ] satisfies RunEvent[]
    ).flatMap(event => formatRunEvent(event, 4, new Map()));
    expect(lines).toEqual([
      "lead │ fork · opus, session f1, to answer a question",
      "lead │ fork · b.",
      "lead │ Delegating.",
    ]);
  });
});
