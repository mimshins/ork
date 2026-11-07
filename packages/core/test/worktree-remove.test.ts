/**
 * @file Tests for what `ork worktrees remove` and the Worktrees panel share
 *   with clean: a run still going keeps its worktree even forced; removing one
 *   item needs `force` exactly when it loses work, which is read from git as
 *   git prints it; a branch with no worktree is deleted; a missing worktree is
 *   pruned; and the plain words both say.
 */

import { rmSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyRemove,
  type CleanStep,
  liveRunIds,
  lostWork,
  openStore,
  type OrkWorktree,
  planClean,
  planLine,
  planRemove,
  readWorktrees,
  removeRefusal,
  stateParts,
} from "../src/index.ts";
import { repo, sh, write } from "./fixtures/git.ts";

/** A worktree on `ork/r1/<node>` beside the repo, with its folder. */
const worktree = (root: string, node: string): string => {
  const place = path.join(path.dirname(root), `ork-r1-${node}`);
  sh(root, "worktree", "add", "--quiet", "-b", `ork/r1/${node}`, place);
  return place;
};

const commitIn = (place: string, file: string): void => {
  write(place, file, `${file}\n`);
  sh(place, "add", "-A");
  sh(place, "commit", "--quiet", "-m", `add ${file}`);
};

const firstOf = (items: readonly OrkWorktree[]): OrkWorktree => {
  const [first] = items;
  if (first === undefined) throw new Error("No item.");
  return first;
};

const read = async (root: string, live: readonly string[] = []) => ({
  ...(await readWorktrees(openStore(":memory:"), root)),
  live: new Set(live),
});

const planned = (
  found: Awaited<ReturnType<typeof read>>,
  key: string,
  deleteBranch = false,
) => {
  const answer = planRemove(found, key, deleteBranch);
  if (!answer.ok) throw new Error(answer.error);
  return answer.plan;
};

describe("a run still going", () => {
  it("keeps its worktree from clean, even forced", async () => {
    const root = repo();
    worktree(root, "lead");
    const { items } = await read(root);
    const steps = planClean(
      items,
      { merged: false },
      { branches: true, force: true, live: new Set(["r1"]) },
    );
    expect(steps.map(s => [s.removeWorktree, s.skip])).toEqual([
      [false, "its run is still going"],
    ]);
  });

  it("refuses its remove, and says to stop it first", async () => {
    const root = repo();
    worktree(root, "lead");
    expect(planRemove(await read(root, ["r1"]), "ork/r1/lead", false)).toEqual({
      ok: false,
      error: "Can't remove ork/r1/lead: run r1 is still going; stop it first.",
      gone: false,
    });
  });

  it("is a run of the project whose process is alive", () => {
    const store = openStore(":memory:");
    store.begin({
      id: "r1",
      workflow: "w",
      file: "/w.ork.yaml",
      project: "/p",
    });
    store.begin({
      id: "r2",
      workflow: "w",
      file: "/w.ork.yaml",
      project: "/q",
    });
    expect([...liveRunIds(store, "/p")]).toEqual(["r1"]);
  });
});

describe("removing one worktree", () => {
  it("needs no force for a clean merged worktree, and removes it", async () => {
    const root = repo();
    const place = worktree(root, "lead");
    const found = await read(root);
    const plan = planned(found, "ork/r1/lead");
    expect(plan.force).toBe(false);
    expect(planLine(plan.step)).toEqual({
      text: "ork/r1/lead: remove worktree",
    });
    expect(await applyRemove(root, plan)).toEqual([`removed ${place}`]);
    expect((await read(root)).items.map(i => [i.branch, i.path])).toEqual([
      ["ork/r1/lead", null],
    ]);
  });

  it("needs force for changes and an unmerged branch, and lists what's lost", async () => {
    const root = repo();
    const place = worktree(root, "lead");
    commitIn(place, "done.ts");
    write(place, "wip.ts", "wip\n");
    const found = await read(root);
    expect(stateParts(firstOf(found.items), "main")).toEqual([
      { text: "uncommitted changes", risk: true },
      { text: "1 commit not merged into main", risk: false },
    ]);
    const plan = planned(found, "ork/r1/lead", true);
    expect(plan.force).toBe(true);
    const lost = await lostWork(root, plan);
    expect(lost.changes).toEqual(["?? wip.ts"]);
    expect(lost.commitsOn).toBe("unmerged");
    expect(lost.commits.map(c => c.replace(/^\w+ /u, ""))).toEqual([
      "add done.ts",
    ]);
    expect(await applyRemove(root, plan)).toEqual([
      `removed ${place}`,
      "deleted ork/r1/lead",
    ]);
  });

  it("deletes a branch with no worktree, which is what removing it means", async () => {
    const root = repo();
    sh(root, "branch", "ork/r2/docs");
    const plan = planned(await read(root), "ork/r2/docs");
    expect([plan.step.removeWorktree, plan.step.deleteBranch]).toEqual([
      false,
      true,
    ]);
    expect(await applyRemove(root, plan)).toEqual(["deleted ork/r2/docs"]);
  });

  it("prunes a worktree whose folder is gone, keeping its branch", async () => {
    const root = repo();
    const place = worktree(root, "lead");
    rmSync(place, { recursive: true });
    const plan = planned(await read(root), "ork/r1/lead");
    expect(planLine(plan.step).text).toBe("ork/r1/lead: prune worktree");
    expect(await applyRemove(root, plan)).toEqual([`pruned ${place}`]);
  });

  it("names nothing it doesn't have", async () => {
    const root = repo();
    expect(planRemove(await read(root), "ork/r9/none", false)).toEqual({
      ok: false,
      error: "No Ork worktree or branch ork/r9/none.",
      gone: true,
    });
  });
});

describe("the words", () => {
  const item: OrkWorktree = {
    runId: "r1",
    nodeId: "check",
    path: "/w/check",
    missing: false,
    dirty: false,
    changes: 0,
    ahead: 2,
    merged: false,
    inMainCheckout: false,
  };
  const keep: CleanStep = {
    item,
    removeWorktree: false,
    deleteBranch: false,
    skip: "commits on no branch",
  };

  it("say a detached worktree's commits on no branch, and its plan line", () => {
    expect(stateParts(item)).toEqual([
      { text: "2 commits on no branch", risk: true },
    ]);
    expect(planLine(keep)).toEqual({
      text: "r1/check (detached): keep",
      reason: "commits on no branch",
    });
  });

  it("refuse the main checkout's branch", () => {
    expect(removeRefusal({ ...item, inMainCheckout: true }, false)).toBe(
      "checked out in the main checkout; switch it to another branch first",
    );
    expect(removeRefusal(item, false)).toBeUndefined();
  });
});
