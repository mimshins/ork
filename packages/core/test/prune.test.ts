/**
 * @file Tests for `ork prune`'s plan and its effect: old finished runs go with
 *   their folders and their ledger stays; live runs, worktrees, live links and
 *   a call's other runs hold a run back.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPrune,
  type EventStore,
  openStore,
  planPrune,
  type RunEvent,
} from "../src/index.ts";

const FAR_FUTURE = "2999-01-01T00:00:00.000Z";
const LONG_AGO = "2000-01-01T00:00:00.000Z";
const noWorktrees = () => Promise.resolve(new Set<string>());

const FINISHED = (runId: string): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

const USAGE = {
  costUsd: 1,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

const finishedRun = (
  store: EventStore,
  id: string,
  options: { project?: string; parent?: string } = {},
): void => {
  const project = options.project ?? "/p/one";
  store.begin({
    id,
    workflow: "w",
    file: `${project}/w`,
    project,
    ...(options.parent === undefined ? {} : { parent: options.parent }),
  });
  store.append(id, {
    type: "node.event",
    id: "n",
    event: {
      type: "session.finished",
      outcome: {
        subtype: "success",
        sessionId: "s",
        report: null,
        text: "",
        usage: USAGE,
        errors: [],
      },
    },
  });
  store.append(id, FINISHED(id));
};

const ids = (runs: readonly { id: string }[]) => runs.map(r => r.id).toSorted();

describe("ork prune", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("removes a run that ended before the cutoff, and no newer one", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "old");
    const none = await planPrune(store, { before: LONG_AGO }, noWorktrees);
    expect(none).toEqual({ remove: [], keep: [] });
    const plan = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    expect(ids(plan.remove)).toEqual(["old"]);
  });

  it("forgets the run and its folder, and keeps what it spent", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-prune-")));
    dirs.push(root);
    const folder = path.join(root, ".ork", "runs", "old");
    mkdirSync(folder, { recursive: true });
    const store = openStore(":memory:");
    finishedRun(store, "old", { project: root });
    const plan = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    expect(applyPrune(store, plan)).toEqual({
      removed: 1,
      folders: 1,
      failed: [],
    });
    expect(store.lookup("old")).toEqual([]);
    expect(store.events("old")).toEqual([]);
    expect(existsSync(folder)).toBe(false);
    expect(store.usage()).toHaveLength(1);
    expect(store.compact()).toBeNull();
  });

  it("reads a run's age from its last event, so a recent chat keeps it", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "old");
    const [{ finishedAt } = { finishedAt: "" }] = store.lookup("old");
    expect(store.lastEventAt("old")).toBe(finishedAt);
    store.append("old", { type: "node.skipped", id: "n" });
    const last = String(store.lastEventAt("old"));
    const plan = await planPrune(store, { before: last }, noWorktrees);
    expect(plan.remove).toEqual([]);
    const after = await planPrune(store, { before: `${last}Z` }, noWorktrees);
    expect(ids(after.remove)).toEqual(["old"]);
  });

  it("keeps a project's runs when git fails, and says why", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "old");
    const plan = await planPrune(store, { before: FAR_FUTURE }, () =>
      Promise.reject(new Error("detected dubious ownership")),
    );
    expect(plan.remove).toEqual([]);
    expect(plan.keep[0]?.reason).toContain("dubious ownership");
  });

  it("removes runs of a folder that is no repository, or is gone", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-prune-")));
    dirs.push(root);
    const store = openStore(":memory:");
    finishedRun(store, "plain", { project: root });
    finishedRun(store, "gone", { project: path.join(root, "gone") });
    const plan = await planPrune(store, { before: FAR_FUTURE });
    expect(ids(plan.remove)).toEqual(["gone", "plain"]);
  });

  it("refuses to delete a run that is running again", () => {
    const store = openStore(":memory:");
    store.begin({ id: "live", workflow: "w", file: "/p/w", project: "/p/one" });
    const stale = store.lookup("live");
    expect(applyPrune(store, { remove: stale })).toEqual({
      removed: 0,
      folders: 0,
      failed: [{ run: "live", reason: "it is running again" }],
    });
    expect(store.lookup("live")).toHaveLength(1);
  });

  it("does not shrink the store while a run is going", () => {
    const store = openStore(":memory:");
    store.begin({ id: "live", workflow: "w", file: "/p/w", project: "/p/one" });
    expect(store.compact()).toBe("a run is going");
  });

  it("keeps to the project it is given", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "one", { project: "/p/one" });
    finishedRun(store, "two", { project: "/p/two" });
    const plan = await planPrune(
      store,
      { before: FAR_FUTURE, project: "/p/two" },
      noWorktrees,
    );
    expect(ids(plan.remove)).toEqual(["two"]);
    expect(plan.keep).toEqual([]);
  });

  it("keeps a live run", async () => {
    const store = openStore(":memory:");
    store.begin({ id: "live", workflow: "w", file: "/p/w", project: "/p/one" });
    const plan = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toMatchObject([
      { run: { id: "live" }, reason: "it is still running" },
    ]);
  });

  it("keeps a run that still has a worktree or branch", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "kept");
    finishedRun(store, "gone");
    const plan = await planPrune(store, { before: FAR_FUTURE }, () =>
      Promise.resolve(new Set(["kept"])),
    );
    expect(ids(plan.remove)).toEqual(["gone"]);
    expect(plan.keep[0]?.reason).toContain("worktree");
  });

  it("keeps a run with a live link", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "a");
    finishedRun(store, "b");
    store.addLink({ run: "a", node: "x" }, { run: "b", node: "y" }, 5);
    const plan = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    expect(plan.remove).toEqual([]);
    expect(ids(plan.keep.map(k => k.run))).toEqual(["a", "b"]);
  });

  it("drops an ended link with its runs", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "a");
    finishedRun(store, "b");
    const link = store.addLink(
      { run: "a", node: "x" },
      { run: "b", node: "y" },
      5,
    );
    store.endLink(link.id);
    const plan = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    applyPrune(store, plan);
    expect(store.links()).toEqual([]);
    expect(store.runs()).toEqual([]);
  });

  it("removes a call's runs together, or holds them all back", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "top");
    finishedRun(store, "child", { parent: "top" });
    const all = await planPrune(store, { before: FAR_FUTURE }, noWorktrees);
    expect(ids(all.remove)).toEqual(["child", "top"]);
    const held = await planPrune(store, { before: FAR_FUTURE }, () =>
      Promise.resolve(new Set(["child"])),
    );
    expect(held.remove).toEqual([]);
    expect(held.keep.find(k => k.run.id === "top")?.reason).toContain(
      "run child of its call stays",
    );
  });

  it("holds back a call that reaches a project out of scope", async () => {
    const store = openStore(":memory:");
    finishedRun(store, "top", { project: "/p/one" });
    finishedRun(store, "child", { project: "/p/two", parent: "top" });
    const plan = await planPrune(
      store,
      { before: FAR_FUTURE, project: "/p/one" },
      noWorktrees,
    );
    expect(plan.remove).toEqual([]);
    expect(plan.keep[0]?.reason).toContain("--all");
  });
});
