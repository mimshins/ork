/**
 * @file Tests for `forEach` nodes in real git worktrees (RFC-013): an item's
 *   worktree and branch are named by the project's rules with the item's id, a
 *   root node's passing items keep their branches, and a fanned node with an
 *   owner merges (or patches) each passing item into it, one at a time, also
 *   under `commit: never`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  branchName,
  createWorkspace,
  gitRulesOf,
  resolveBase,
  resumeState,
  type NodeExecutor,
  type RunEvent,
  worktreePath,
} from "../src/index.ts";
import { refreshWorktree } from "../src/worktree/handoff.ts";
import {
  compile,
  repo,
  runIn,
  sh,
  type Work,
  working,
} from "./fixtures/git.ts";

const ITEMS = "[a, b, c]";

/** Each time the fanned node `build` finished. */
const buildFinished = (events: readonly RunEvent[]): RunEvent[] =>
  events.filter(
    event => event.type === "node.finished" && event.id === "build",
  );

/** A worker with `forEach`, alone or owned by a leader, under these rules. */
const fanned = (options: {
  rules?: string | undefined;
  owned?: boolean;
  each?: string;
}) =>
  compile(
    [
      "schemaVersion: 1",
      "name: fan",
      ...(options.rules === undefined
        ? []
        : [`rules: { git: ${options.rules} }`]),
      "nodes:",
      ...(options.owned === true ? ["  lead: { type: claude.leader }"] : []),
      "  build:",
      "    type: claude.worker",
      ...(options.owned === true ? ["    parent: lead"] : []),
      `    forEach: ${options.each ?? `{ items: ${ITEMS}, maxParallel: 1 }`}`,
      '    prompt: "do {{item}}"',
      ...(options.owned === true ? ["edges:", "  - lead -> build"] : []),
    ].join("\n"),
  );

/** An executor that reports `id` failed after doing its work. */
const failingAt =
  (id: string, executor: NodeExecutor): NodeExecutor =>
  async context => {
    const done = await executor(context);
    return { ...done, ok: done.ok && context.id !== id };
  };

const items = (work: (item: string) => Work): Record<string, Work> =>
  Object.fromEntries(
    ["a", "b", "c"].map((item, at) => [`build.${String(at)}`, work(item)]),
  );

/**
 * Items that all start before any finishes, so they branch from the same
 * commit, and their work meets only when it is merged.
 */
const together = (work: Record<string, Work>, count: number) => {
  const { executor, cwds } = working(work);
  let started = 0;
  const { promise: everyone, resolve: release } = Promise.withResolvers<void>();
  const waiting: NodeExecutor = async context => {
    if (context.id.startsWith("build.")) {
      started += 1;
      if (started === count) release();
      await everyone;
    }
    return executor(context);
  };
  return { executor: waiting, cwds };
};

const branches = (root: string) =>
  sh(root, "branch", "--format=%(refname:short)", "--list", "ork/*")
    .split("\n")
    .filter(name => name !== "");

/** Which items reached their owner, and which conflicted, from `<id> <action>`. */
const handedOver = (worktreeEvents: readonly string[]) => {
  const ids = (action: string) =>
    worktreeEvents
      .filter(entry => entry.endsWith(` ${action}`))
      .map(entry => entry.split(" ")[0]);
  return { merged: ids("merged"), conflicts: ids("conflict") };
};

const resultsField = (output: Record<string, unknown>): unknown =>
  output["results"];

/** The gathered `results` of the node `build`. */
const resultsOf = (events: readonly RunEvent[]) =>
  events.flatMap(e =>
    e.type === "node.finished" && e.id === "build"
      ? [resultsField(e.output)]
      : [],
  );

describe("a fanned node's item worktrees", () => {
  it("are named with the item id, and a root node's passing items keep their branches", async () => {
    const root = repo();
    const { executor, cwds, prompts } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const { result, worktreeEvents, events } = await runIn(
      root,
      fanned({}),
      executor,
    );

    expect(result.status).toBe("succeeded");
    expect(cwds).toEqual({
      "build.0": worktreePath(root, "r1", "build.0"),
      "build.1": worktreePath(root, "r1", "build.1"),
      "build.2": worktreePath(root, "r1", "build.2"),
    });
    expect(prompts["build.2"]).toBe(branchName("r1", "build.2"));
    expect(branches(root)).toEqual([
      "ork/r1/build.0",
      "ork/r1/build.1",
      "ork/r1/build.2",
    ]);
    expect(worktreeEvents).toEqual([
      "build.0 created",
      "build.0 committed",
      "build.1 created",
      "build.1 committed",
      "build.2 created",
      "build.2 committed",
    ]);
    expect(result.worktrees.map(w => [w.id, w.branch, w.reason])).toEqual([
      ["build.0", "ork/r1/build.0", "the run's result"],
      ["build.1", "ork/r1/build.1", "the run's result"],
      ["build.2", "ork/r1/build.2", "the run's result"],
    ]);
    expect(resultsOf(events)).toMatchObject([
      ["build.0", "build.1", "build.2"].map(id => ({
        branch: `ork/r1/${id}`,
        worktree: worktreePath(root, "r1", id),
      })),
    ]);
  });

  it("are named by custom rules, and the names stay valid git names", async () => {
    const root = repo();
    const { executor, cwds, prompts } = working(items(() => ({})));
    const { result } = await runIn(
      root,
      fanned({
        rules: '{ branch: "task/{run}-{node}", worktrees: "../wt/{node}" }',
      }),
      executor,
    );

    expect(result.status).toBe("succeeded");
    expect(cwds["build.1"]).toBe(
      path.join(path.dirname(root), "wt", "build.1"),
    );
    expect(prompts["build.1"]).toBe("task/r1-build.1");
    expect(sh(root, "check-ref-format", "--branch", "task/r1-build.1")).toBe(
      "task/r1-build.1\n",
    );
  });

  it("have no branches under commit: never, and the results say where they are", async () => {
    const root = repo();
    const { executor } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const { result, events } = await runIn(
      root,
      fanned({ rules: "{ commit: never }" }),
      executor,
    );

    expect(result.status).toBe("succeeded");
    expect(branches(root)).toEqual([]);
    expect(
      readFileSync(
        path.join(worktreePath(root, "r1", "build.0"), "src/a.ts"),
        "utf8",
      ),
    ).toBe("a\n");
    const [gathered] = resultsOf(events);
    expect(gathered).toEqual(
      ["build.0", "build.1", "build.2"].map(id => ({
        summary: "ok",
        worktree: worktreePath(root, "r1", id),
      })),
    );
    expect(result.worktrees.map(w => w.reason)).toEqual(
      Array.from({ length: 3 }, () => "the run's result, uncommitted"),
    );
  });
});

describe("a fanned node with an owner", () => {
  it("merges each passing item into it, one at a time", async () => {
    const root = repo();
    const { executor } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const { result, worktreeEvents } = await runIn(
      root,
      fanned({ owned: true, each: `{ items: ${ITEMS} }` }),
      executor,
    );
    const lead = worktreePath(root, "r1", "lead");

    expect(result.status).toBe("succeeded");
    // Parallel by default, yet a merge starts only after the one before it.
    expect(
      worktreeEvents.filter(action => /merged|removed/u.test(action)),
    ).toHaveLength(6);
    expect(sh(lead, "ls-files", "src")).toBe(
      "src/a.ts\nsrc/app.ts\nsrc/b.ts\nsrc/c.ts\n",
    );
    expect(
      sh(lead, "log", "--merges", "--format=%s").trim().split("\n"),
    ).toHaveLength(3);
    // Merged items' worktrees are removed; their branches stay.
    expect(existsSync(worktreePath(root, "r1", "build.0"))).toBe(false);
    expect(branches(root)).toContain("ork/r1/build.0");
  });

  it("keeps the worktree of an item that conflicts, and merges the rest", async () => {
    const root = repo();
    const { executor } = together(
      {
        "build.0": { files: { "src/app.ts": "zero\n" } },
        "build.1": { files: { "src/app.ts": "one\n" } },
        "build.2": { files: { "src/c.ts": "c\n" } },
      },
      3,
    );
    const { result, worktreeEvents, events } = await runIn(
      root,
      fanned({ owned: true, each: `{ items: ${ITEMS} }` }),
      executor,
    );
    const lead = worktreePath(root, "r1", "lead");

    // Whichever of the two that touch one file is merged second conflicts.
    const { merged, conflicts } = handedOver(worktreeEvents);
    const [loser = ""] = conflicts;
    expect(conflicts).toHaveLength(1);
    expect(merged).toHaveLength(2);
    expect(merged).toContain("build.2");
    expect(existsSync(worktreePath(root, "r1", loser))).toBe(true);
    expect(result.worktrees.map(w => [w.id, w.reason])).toContainEqual([
      loser,
      "merge conflict in src/app.ts",
    ]);
    expect(["zero\n", "one\n"]).toContain(
      readFileSync(path.join(lead, "src/app.ts"), "utf8"),
    );
    expect(resultsOf(events)).toHaveLength(1);
    // The owner is missing that item's work, so the node did not succeed.
    const finished = buildFinished(events);
    expect(finished).toMatchObject([{ ok: false }]);
    expect(JSON.stringify(finished)).toContain('"merge":{"ok":false');
    expect(JSON.stringify(finished)).toContain('"fail"');
  });

  it("keeps the worktree of an item that failed, saying so", async () => {
    const root = repo();
    const { executor } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const failing = failingAt("build.1", executor);
    const { result } = await runIn(
      root,
      fanned({ owned: true, each: `{ items: ${ITEMS} }` }),
      failing,
    );

    expect(result.worktrees.map(w => [w.id, w.reason])).toContainEqual([
      "build.1",
      "item failed; kept for inspection",
    ]);
    expect(existsSync(worktreePath(root, "r1", "build.1"))).toBe(true);
  });

  it("applies each item as a patch under commit: never, one at a time", async () => {
    const root = repo();
    const head = sh(root, "rev-parse", "HEAD");
    const { executor } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const { result, worktreeEvents } = await runIn(
      root,
      fanned({ rules: "{ commit: never }", owned: true }),
      executor,
    );
    const lead = worktreePath(root, "r1", "lead");

    expect(result.status).toBe("succeeded");
    expect(worktreeEvents.filter(a => a.endsWith("merged"))).toEqual([
      "build.0 merged",
      "build.1 merged",
      "build.2 merged",
    ]);
    expect(
      sh(lead, "status", "--porcelain")
        .split("\n")
        .filter(line => line !== "")
        .map(line => line.slice(3))
        .toSorted(),
    ).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(sh(lead, "rev-parse", "HEAD")).toBe(head);
    expect(branches(root)).toEqual([]);
  });

  it("keeps a conflicting item's worktree under commit: never", async () => {
    const root = repo();
    const { executor } = together(
      {
        "build.0": { files: { "src/new.ts": "zero\n" } },
        "build.1": { files: { "src/new.ts": "one\n" } },
        "build.2": { files: { "src/c.ts": "c\n" } },
      },
      3,
    );
    const { result, worktreeEvents } = await runIn(
      root,
      fanned({
        rules: "{ commit: never }",
        owned: true,
        each: `{ items: ${ITEMS} }`,
      }),
      executor,
    );

    const { merged, conflicts } = handedOver(worktreeEvents);
    expect(conflicts).toHaveLength(1);
    expect(merged).toHaveLength(2);
    expect(result.worktrees.map(w => w.id)).toContain(conflicts[0]);
  });

  it("keeps every item's worktree with merge: never", async () => {
    const root = repo();
    const { executor } = working(
      items(item => ({ files: { [`src/${item}.ts`]: `${item}\n` } })),
    );
    const { result } = await runIn(
      root,
      fanned({ rules: "{ commit: never, merge: never }", owned: true }),
      executor,
    );

    expect(
      result.worktrees
        .filter(w => w.id.startsWith("build."))
        .map(w => w.reason),
    ).toEqual(
      Array.from({ length: 3 }, () => "kept for its owner (merge: never)"),
    );
  });
});

/** A workspace over `graph` in `root`, adopting what `before` left. */
const workspaceFor = async (
  root: string,
  graph: ReturnType<typeof fanned>,
  before: RunEvent[],
  onEvent: (event: RunEvent) => void,
) => {
  const state = resumeState(before);
  return createWorkspace({
    graph,
    runId: "r1",
    root,
    head: await resolveBase(root, gitRulesOf(graph.workflow), {}),
    onEvent,
    adopt: state.worktrees,
    known: state.branches,
  });
};

describe("resuming a fanned node", () => {
  it.each([
    ["with a branch", undefined],
    ["detached, under commit: never", "{ commit: never }"],
  ])("adopts an item's worktree, %s", async (_name, rules) => {
    const root = repo();
    const graph = fanned({ rules });
    const first: RunEvent[] = [];
    const opened = await workspaceFor(root, graph, [], e => {
      first.push(e);
    });
    const one = await opened.prepare("build.1", "build");
    const second: RunEvent[] = [];
    const resumed = await workspaceFor(root, graph, first, e => {
      second.push(e);
    });
    const again = await resumed.prepare("build.1", "build");

    expect(again.cwd).toBe(one.cwd);
    expect(again.cwd).toBe(worktreePath(root, "r1", "build.1"));
    expect(second).toEqual([]);
  });
});

describe("an item that fails, then passes in a later round", () => {
  it("is kept as the run's result, not as a failed item", async () => {
    const root = repo();
    const workspace = await workspaceFor(root, fanned({}), [], () => {});
    await workspace.prepare("build.1", "build");
    await workspace.finish("build.1", { ok: false, output: {} });
    await workspace.finish("build.1", { ok: true, output: {} });
    const kept = await workspace.close();

    expect(kept.map(w => [w.id, w.reason])).toEqual([
      ["build.1", "the run's result"],
    ]);
  });
});

describe("a worktree that runs again under merge: patch", () => {
  type Rules = Parameters<typeof refreshWorktree>[0];
  const PATCH: Rules = {
    commit: "auto",
    merge: "patch",
    base: "HEAD",
    branch: "b",
    worktrees: "w",
  };

  it("starts its next patch from what it handed over", async () => {
    const root = repo();
    const worktree = { path: root, snapshot: "before" };
    await expect(
      refreshWorktree(PATCH, worktree, { path: root }, true),
    ).resolves.toBe(true);
    expect(worktree.snapshot).toBe(sh(root, "rev-parse", "HEAD^{tree}").trim());
  });

  it("keeps its starting point when nothing was handed over", async () => {
    const root = repo();
    const worktree = { path: root, snapshot: "before" };
    await expect(
      refreshWorktree(PATCH, worktree, { path: root }, false),
    ).resolves.toBe(false);
    expect(worktree.snapshot).toBe("before");
  });
});
