/**
 * @file Tests for a node's `lock` (RFC-016) on scripted executors: two runs
 *   integrating into one branch of a bare remote go in turn and neither push is
 *   rejected; a dead holder's record is taken over; the lock goes when a run
 *   fails or is stopped; a fanned node's items take it one at a time; a resume
 *   reruns what ran under a lock the run ended holding; and the keys.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it, vi } from "vitest";

import {
  activeTree,
  type CompiledGraph,
  compileWorkflow,
  fileLockLedgers,
  type LockLedgers,
  lockIsLocal,
  lockWaitsOf,
  type NodeExecutor,
  remoteKey,
  resumeState,
  type RunEvent,
  startRun,
} from "../src/index.ts";

const temp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-lock-${name}-`));

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

/** `rebase -> push`, both naming the branch's lock. */
const integrate = compile([
  "inputs:",
  "  branch: { type: string }",
  "nodes:",
  "  rebase: { type: tool.shell, command: rebase, lock: 'branch:{{inputs.branch}}' }",
  "  push: { type: tool.shell, command: push, lock: 'branch:{{inputs.branch}}' }",
  "edges:",
  "  - rebase -> push",
]);

const human = {
  ask: () => Promise.resolve(""),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const pass = { ok: true, output: {} } as const;

const begin = (options: {
  graph: CompiledGraph;
  executor: NodeExecutor;
  locks: LockLedgers;
  runId: string;
  cwd?: string;
}) => {
  const events: RunEvent[] = [];
  const handle = startRun({
    graph: options.graph,
    inputs: { branch: "main" },
    cwd: options.cwd ?? temp("cwd"),
    executors: { "tool.shell": options.executor },
    human,
    runId: options.runId,
    locks: options.locks,
    onEvent: event => {
      events.push(event);
    },
  });
  return { handle, events };
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

/** A bare remote with one commit on `main`, and two clones of it. */
const remoteWithClones = (): { remote: string; clones: [string, string] } => {
  const remote = path.join(temp("remote"), "origin.git");
  git(tmpdir(), "init", "--bare", remote);
  const seed = path.join(temp("seed"), "seed");
  git(tmpdir(), "clone", remote, seed);
  writeFileSync(path.join(seed, "README"), "seed\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");
  git(seed, "push", "origin", "HEAD:main");
  const clone = (name: string): string => {
    const at = path.join(temp("clone"), name);
    git(tmpdir(), "clone", remote, at);
    return at;
  };
  return { remote, clones: [clone("a"), clone("b")] };
};

/** Takes `lock` in `ledgers` for a process, then makes that process a dead one. */
const staleHolder = async (
  dir: string,
  ledgers: LockLedgers,
  lock: string,
): Promise<void> => {
  await (
    await ledgers.of(lock)
  ).take(
    { run: "r0", node: "push", pid: process.pid },
    { signal: new AbortController().signal },
  );
  for (const folder of readdirSync(dir)) {
    writeFileSync(
      path.join(dir, folder, "slot-0.json"),
      JSON.stringify({ id: "x", run: "r0", node: "push", pid: deadPid() }),
    );
  }
};

const ledgersIn = (): LockLedgers => {
  const repo = temp("repo");
  return fileLockLedgers({
    dir: temp("locks"),
    repo,
    project: repo,
    pollMs: 10,
  });
};

const ran = (end: "span" | "run"): RunEvent[] => [
  { type: "node.started", id: "rebase", nodeType: "tool.shell", round: 1 },
  { type: "lock.taken", id: "rebase", lock: "branch:main" },
  { type: "node.finished", id: "rebase", round: 1, ok: true, output: {} },
  { type: "lock.released", id: "rebase", lock: "branch:main", end },
];

/** Fetches and rebases (slowly), then pushes; as a `publish` does. */
const integrator: NodeExecutor = async context => {
  if (context.id === "rebase") {
    git(context.cwd, "fetch", "origin", "main");
    git(context.cwd, "rebase", "FETCH_HEAD");
    writeFileSync(path.join(context.cwd, `${context.runId}.txt`), "work\n");
    git(context.cwd, "add", "-A");
    git(context.cwd, "commit", "-m", context.runId);
    await sleep(100);
    return pass;
  }
  git(context.cwd, "push", "origin", "HEAD:refs/heads/main");
  return pass;
};

/** A process that has already ended. */
const deadPid = (): number => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  if (pid === undefined) throw new Error("no pid");
  return pid;
};

const lockEvents = (events: RunEvent[]) =>
  events.filter(event => event.type.startsWith("lock."));

describe("a lock across runs", () => {
  it("orders two runs on one branch: the second waits, then rebases onto the first's push", async () => {
    const { remote, clones } = remoteWithClones();
    const dir = temp("locks");
    const ledgers = (repo: string) =>
      fileLockLedgers({ dir, repo, project: repo, pollMs: 10 });
    const [a, b] = clones;
    const first = begin({
      graph: integrate,
      executor: integrator,
      locks: ledgers(a),
      runId: "r1",
      cwd: a,
    });
    await vi.waitFor(() => {
      expect(first.events.some(e => e.type === "lock.taken")).toBe(true);
    });
    const second = begin({
      graph: integrate,
      executor: integrator,
      locks: ledgers(b),
      runId: "r2",
      cwd: b,
    });
    const [one, two] = await Promise.all([
      first.handle.done,
      second.handle.done,
    ]);
    expect([one.status, two.status]).toEqual(["succeeded", "succeeded"]);
    const lock = `branch:main`;
    expect(lockEvents(first.events)).toEqual([
      { type: "lock.taken", id: "rebase", lock },
      { type: "lock.taken", id: "push", lock },
      { type: "lock.released", id: "push", lock, end: "span" },
    ]);
    expect(lockEvents(second.events)[0]).toEqual({
      type: "lock.waiting",
      id: "rebase",
      lock,
      holders: ["r1/rebase"],
    });
    expect(git(remote, "log", "--format=%s", "main").split("\n")).toEqual([
      "r2",
      "r1",
      "seed",
      "",
    ]);
  });

  it("takes over the record of a holder whose process is gone", async () => {
    const dir = temp("locks");
    const repo = temp("repo");
    const ledgers = fileLockLedgers({ dir, repo, project: repo, pollMs: 10 });
    await staleHolder(dir, ledgers, "branch:main");
    const { handle } = begin({
      graph: integrate,
      executor: () => Promise.resolve(pass),
      locks: ledgers,
      runId: "r1",
      cwd: repo,
    });
    expect((await handle.done).status).toBe("succeeded");
    expect((await ledgers.of("branch:main")).holders()).toEqual([]);
  });
});

describe("a lock's end", () => {
  it("goes when a locked node fails and the run ends before the next", async () => {
    const ledgers = ledgersIn();
    const { handle, events } = begin({
      graph: integrate,
      executor: () => Promise.resolve({ ok: false, output: {}, error: "no" }),
      locks: ledgers,
      runId: "r1",
    });
    expect((await handle.done).status).toBe("failed");
    expect(lockEvents(events).at(-1)).toEqual({
      type: "lock.released",
      id: "rebase",
      lock: "branch:main",
      end: "run",
    });
    expect((await ledgers.of("branch:main")).holders()).toEqual([]);
  });

  it("goes when the run is stopped while holding it", async () => {
    const ledgers = ledgersIn();
    const { handle, events } = begin({
      graph: integrate,
      executor: context =>
        new Promise(resolve => {
          context.signal.addEventListener("abort", () => {
            resolve({ ok: false, output: {}, error: "stopped" });
          });
        }),
      locks: ledgers,
      runId: "r1",
    });
    await vi.waitFor(() => {
      expect(events.some(e => e.type === "lock.taken")).toBe(true);
    });
    handle.interrupt();
    expect((await handle.done).status).toBe("interrupted");
    expect(lockEvents(events).at(-1)).toMatchObject({ end: "run" });
    expect((await ledgers.of("branch:main")).holders()).toEqual([]);
  });

  it("takes it per item on a fanned node: one item at a time", async () => {
    const graph = compile([
      "nodes:",
      "  each:",
      "    type: tool.shell",
      "    command: x",
      "    lock: deploy",
      "    forEach: { items: [a, b, c] }",
    ]);
    let running = 0;
    let most = 0;
    const { handle, events } = begin({
      graph,
      executor: async () => {
        running += 1;
        most = Math.max(most, running);
        await sleep(20);
        running -= 1;
        return pass;
      },
      locks: ledgersIn(),
      runId: "r1",
    });
    expect((await handle.done).status).toBe("succeeded");
    expect(most).toBe(1);
    const taken = events.filter(e => e.type === "lock.taken").length;
    const released = events.filter(e => e.type === "lock.released");
    expect(taken).toBe(3);
    expect(released).toMatchObject([
      { end: "span" },
      { end: "span" },
      { end: "span" },
    ]);
  });
});

/** Holds `lock` in `ledgers` for another run; resolves with its release. */
const heldElsewhere = async (ledgers: LockLedgers, lock: string) =>
  (await ledgers.of(lock)).take(
    { run: "r0", node: "push", pid: process.pid },
    { signal: new AbortController().signal },
  );

const at = "2026-11-11T00:00:00.000Z";

const lockWaitRun: RunEvent[] = [
  {
    type: "run.started",
    runId: "r2",
    workflow: "w",
    entries: ["push"],
    nodes: [{ id: "push", type: "tool.shell" }],
  },
  { type: "node.started", id: "push", nodeType: "tool.shell", round: 1 },
  {
    type: "lock.waiting",
    id: "push",
    lock: "branch:main",
    holders: ["r1/push"],
  },
];

const stored = (events: RunEvent[]) =>
  events.map((event, seq) => ({ runId: "r2", seq, at, event }));

describe("a lock's wait", () => {
  it("does not count toward the node's timeout", async () => {
    const graph = compile([
      "nodes:",
      "  push: { type: tool.shell, command: push, lock: deploy, timeout: 1s }",
    ]);
    const ledgers = ledgersIn();
    const release = await heldElsewhere(ledgers, "deploy");
    const { handle } = begin({
      graph,
      executor: () => Promise.resolve(pass),
      locks: ledgers,
      runId: "r1",
    });
    await sleep(1300);
    release?.();
    expect((await handle.done).status).toBe("succeeded");
  });

  it("does not wait for a lock on another branch", async () => {
    const ledgers = ledgersIn();
    await heldElsewhere(ledgers, "branch:other");
    const { handle, events } = begin({
      graph: integrate,
      executor: () => Promise.resolve(pass),
      locks: ledgers,
      runId: "r1",
    });
    expect((await handle.done).status).toBe("succeeded");
    expect(events.some(e => e.type === "lock.waiting")).toBe(false);
  });

  it("is what `ork tree` and the UI say the node is doing, until it takes it", () => {
    const [waiting] = activeTree(stored(lockWaitRun));
    expect(waiting?.now).toBe("waiting for branch:main, held by r1/push");
    const [took] = activeTree(
      stored([
        ...lockWaitRun,
        { type: "lock.taken", id: "push", lock: "branch:main" },
      ]),
    );
    expect(took?.now).toBeUndefined();
  });
});

describe("a lock on resume and in views", () => {
  it("reruns both nodes when the run died after the first, the second started", () => {
    const { history } = resumeState([
      ...ran("run").slice(0, 3),
      { type: "node.started", id: "push", nodeType: "tool.shell", round: 1 },
      { type: "lock.taken", id: "push", lock: "branch:main" },
    ]);
    expect([history.has("rebase"), history.has("push")]).toEqual([
      false,
      false,
    ]);
  });

  it("keeps the run's hold open past an item's own release", () => {
    const { history } = resumeState([
      ...ran("run").slice(0, 3),
      {
        type: "node.started",
        id: "each.0",
        nodeType: "tool.shell",
        round: 1,
        item: { of: "each", index: 0 },
      },
      { type: "lock.taken", id: "each.0", lock: "branch:main" },
      { type: "lock.released", id: "each.0", lock: "branch:main", end: "span" },
      { type: "node.finished", id: "each.0", round: 1, ok: true, output: {} },
    ]);
    expect(history.has("rebase")).toBe(false);
  });

  it("reruns what ran under a lock the run ended holding", () => {
    expect(resumeState(ran("run")).history.has("rebase")).toBe(false);
  });

  it("hands back what ran under a lock it let go", () => {
    expect(resumeState(ran("span")).history.get("rebase")).toHaveLength(1);
  });

  it("lists a node waiting for a lock until it takes it", () => {
    const waiting: RunEvent = {
      type: "lock.waiting",
      id: "push",
      lock: "branch:main",
      holders: ["r1/push"],
    };
    expect(lockWaitsOf([waiting])).toEqual([
      { id: "push", lock: "branch:main", holders: ["r1/push"] },
    ]);
    expect(
      lockWaitsOf([
        waiting,
        { type: "lock.taken", id: "push", lock: "branch:main" },
      ]),
    ).toEqual([]);
  });

  it("keys a remote without its scheme, user or .git", () => {
    const keys = [
      "https://user:token@github.com/o/r.git",
      "git@github.com:o/r.git",
      "ssh://git@github.com/o/r",
    ].map(url => remoteKey(url));
    expect(new Set(keys)).toEqual(new Set(["github.com/o/r"]));
    expect(remoteKey("/tmp/origin.git")).toBe("/tmp/origin");
  });
});

describe("a lock keyed by a path", () => {
  it("is local for a branch lock in a repo with no origin only", async () => {
    const bare = temp("local");
    git(tmpdir(), "init", bare);
    const { clones } = remoteWithClones();
    expect(await lockIsLocal("branch:main", { repo: bare })).toBe(true);
    expect(await lockIsLocal("deploy", { repo: bare })).toBe(false);
    expect(await lockIsLocal("branch:main", { repo: clones[0] })).toBe(false);
  });
});
