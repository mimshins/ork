/**
 * @file Tests for `git.readonly: base`: a readonly node with no owner and no
 *   input's worktree reads one detached worktree at the base that the run
 *   shares, with only the commit (not the checkout's branch, edits or ignored
 *   files), removed when the run ends even with a file an agent left there. An
 *   owner's or an input's worktree still wins, a `continue` node never adopts
 *   it, a run root or the default rule opens none, and a crash's leftover is
 *   adopted on resume.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWorkspace,
  type NodeExecutor,
  type RunEvent,
  worktreePath,
} from "../src/index.ts";
import { compile, repo, runIn, sh, write } from "./fixtures/git.ts";

const READ = "_readonly";

/** A workspace's events, and what each `worktree` one did. */
const recorded = () => {
  const events: RunEvent[] = [];
  const onEvent = (event: RunEvent) => {
    events.push(event);
  };
  const actions = () =>
    events.flatMap(e => (e.type === "worktree" ? [e.action] : []));
  return { events, onEvent, actions };
};

const workflow = (rules: string, nodes: string[], edges: string[] = []) =>
  compile(
    [
      "schemaVersion: 1",
      "name: read",
      ...(rules === "" ? [] : [`rules: { git: { ${rules} } }`]),
      "nodes:",
      ...nodes.map(node => `  ${node}`),
      ...(edges.length === 0 ? [] : ["edges:", ...edges.map(e => `  - ${e}`)]),
    ].join("\n"),
  );

type Seen = {
  cwd: string;
  head: string;
  branch: string;
  dirty: boolean;
  env: boolean;
};

/** Records what each node saw where it ran, and leaves a file there. */
const inspecting = () => {
  const seen: Record<string, Seen> = {};
  const executor: NodeExecutor = context => {
    const { cwd } = context;
    seen[context.id] = {
      cwd,
      head: sh(cwd, "rev-parse", "HEAD").trim(),
      branch: sh(cwd, "rev-parse", "--abbrev-ref", "HEAD").trim(),
      dirty: existsSync(path.join(cwd, "dirty.txt")),
      env: existsSync(path.join(cwd, ".env")),
    };
    write(cwd, `left-${context.id}.txt`, "an agent's leftover\n");
    return Promise.resolve({
      ok: true,
      output: { status: "pass", summary: "ok", artifacts: {} },
    });
  };
  return { executor, seen };
};

/** A node that leaves a file and fails. */
const failing: NodeExecutor = context => {
  write(context.cwd, "left.txt", "leftover\n");
  return Promise.resolve({ ok: false, output: {}, error: "no" });
};

/** A clone whose checkout moved on to another branch, with an edit. */
const movedCheckout = () => {
  const root = repo();
  const base = sh(root, "rev-parse", "HEAD").trim();
  sh(root, "checkout", "-q", "-b", "other");
  write(root, "other.txt", "other\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "other");
  write(root, "dirty.txt", "uncommitted\n");
  return { root, base };
};

describe("git.readonly: base", () => {
  it("gives readonly nodes with no input one detached worktree at the base, removed at the end", async () => {
    const { root, base } = movedCheckout();
    const graph = workflow("base: main, readonly: base", [
      "scout: { type: agent.worker, isolation: readonly }",
      "audit: { type: agent.worker, isolation: readonly }",
    ]);
    const { executor, seen } = inspecting();
    const { result, worktreeEvents } = await runIn(root, graph, executor);
    expect(result.status).toBe("succeeded");
    const read = worktreePath(root, "r1", READ);
    const expected = { cwd: read, head: base, branch: "HEAD", dirty: false };
    expect(seen["scout"]).toEqual({ ...expected, env: false });
    expect(seen["audit"]).toEqual({ ...expected, env: false });
    expect(worktreeEvents).toEqual([`${READ} created`, `${READ} removed`]);
    expect(existsSync(read)).toBe(false);
    expect(sh(root, "worktree", "list")).not.toContain(read);
    expect(result).not.toHaveProperty("worktrees.0");
  });

  it("removes the worktree when the run ends in failure", async () => {
    const root = repo();
    const graph = workflow("readonly: base", [
      "scout: { type: agent.worker, isolation: readonly }",
    ]);
    const { result, worktreeEvents } = await runIn(root, graph, failing);
    expect(result.status).not.toBe("succeeded");
    const read = worktreePath(root, "r1", READ);
    expect(worktreeEvents).toEqual([`${READ} created`, `${READ} removed`]);
    expect(existsSync(read)).toBe(false);
    expect(sh(root, "worktree", "list")).not.toContain(read);
  });

  it("leaves an owner's or an input's worktree first, and is no continue node's input", async () => {
    const root = repo();
    const graph = workflow(
      "readonly: base",
      [
        "lead: { type: agent.leader }",
        "fix: { type: agent.worker, parent: lead }",
        "check: { type: agent.worker, parent: lead, isolation: readonly }",
        "build: { type: agent.worker }",
        "review: { type: agent.worker, isolation: readonly }",
        "scout: { type: agent.worker, isolation: readonly }",
        "next: { type: agent.worker, isolation: continue }",
      ],
      ["lead -> fix", "fix -> check", "build -> review", "scout -> next"],
    );
    const { executor, seen } = inspecting();
    const { result } = await runIn(root, graph, executor);
    expect(result.status).toBe("succeeded");
    const cwds = Object.fromEntries(
      Object.entries(seen).map(([id, s]) => [id, s.cwd]),
    );
    expect(cwds).toMatchObject({
      check: worktreePath(root, "r1", "lead"),
      review: worktreePath(root, "r1", "build"),
      scout: worktreePath(root, "r1", READ),
      next: worktreePath(root, "r1", "next"),
    });
    const next = worktreePath(root, "r1", "next");
    expect(existsSync(path.join(next, "left-scout.txt"))).toBe(false);
  });

  it("is no input beside a worktree: a continue node after both takes the worktree", async () => {
    const root = repo();
    const graph = workflow(
      "readonly: base",
      [
        "scout: { type: agent.worker, isolation: readonly }",
        "build: { type: agent.worker }",
        "next: { type: agent.worker, isolation: continue }",
      ],
      ["scout, build -> next"],
    );
    const { executor, seen } = inspecting();
    const { result } = await runIn(root, graph, executor);
    expect(result.status).toBe("succeeded");
    expect(seen["scout"]?.cwd).toBe(worktreePath(root, "r1", READ));
    expect(seen["next"]?.cwd).toBe(worktreePath(root, "r1", "build"));
  });

  it("changes nothing under the default rule", async () => {
    const root = repo();
    const graph = workflow("", [
      "scout: { type: agent.worker, isolation: readonly }",
    ]);
    const { executor, seen } = inspecting();
    const { worktreeEvents } = await runIn(root, graph, executor);
    expect(seen["scout"]?.cwd).toBe(root);
    expect(worktreeEvents).toEqual([]);
  });

  it("opens nothing in a run root, which is already at the base", async () => {
    const root = repo();
    const graph = workflow("readonly: base", [
      "scout: { type: agent.worker, isolation: readonly }",
    ]);
    const { events, onEvent } = recorded();
    const workspace = createWorkspace({
      graph,
      runId: "r1",
      root,
      head: "HEAD",
      onEvent,
      runRoot: true,
    });
    expect(await workspace.prepare("scout")).toEqual({ cwd: root });
    expect(await workspace.close()).toEqual([]);
    expect(events).toEqual([]);
    expect(existsSync(worktreePath(root, "r1", READ))).toBe(false);
  });

  it("adopts the worktree a crashed run left, and removes it at the end", async () => {
    const root = repo();
    const graph = workflow("readonly: base", [
      "scout: { type: agent.worker, isolation: readonly }",
    ]);
    const crashed = recorded();
    const options = {
      graph,
      runId: "r1",
      root,
      head: sh(root, "rev-parse", "HEAD").trim(),
      onEvent: crashed.onEvent,
    };
    const first = await createWorkspace(options).prepare("scout");
    const read = worktreePath(root, "r1", READ);
    expect(first.cwd).toBe(read);
    expect(crashed.actions()).toEqual(["created"]);
    const again = recorded();
    const resumed = createWorkspace({
      ...options,
      adopt: [{ id: READ, path: read, merged: false }],
      onEvent: again.onEvent,
    });
    expect(await resumed.prepare("scout")).toEqual({ cwd: read });
    expect(await resumed.close()).toEqual([]);
    expect(again.actions()).toEqual(["removed"]);
    expect(existsSync(read)).toBe(false);
  });
});
