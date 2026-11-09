/**
 * @file Tests for what `ork worktrees remove` and the Worktrees panel share
 *   with clean: a run still going keeps its worktree even forced; removing one
 *   item needs `force` exactly when it loses work, which is read from git as
 *   git prints it; a branch with no worktree is deleted; a missing worktree is
 *   dropped by its own path, the user's own missing worktrees kept; a recorded
 *   branch checked out in a worktree Ork didn't create is left alone; and the
 *   plain words both say.
 */

import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyClean,
  applyRemove,
  type CleanStep,
  type CreatedWorktree,
  listOrkWorktrees,
  liveRunIds,
  lostWork,
  openStore,
  type OrkWorktree,
  planClean,
  planLine,
  planRemove,
  removeRefusal,
  stateParts,
} from "../src/index.ts";
import { repo, sh, write } from "./fixtures/git.ts";

/** What the runs of each test repository recorded creating. */
const recorded = new Map<string, CreatedWorktree[]>();

const record = (
  root: string,
  node: string,
  place: string,
  run = "r1",
): void => {
  recorded.set(root, [
    ...(recorded.get(root) ?? []),
    { runId: run, nodeId: node, path: place, branch: `ork/${run}/${node}` },
  ]);
};

/** A worktree on `ork/r1/<node>` beside the repo, with its folder; recorded. */
const worktree = (root: string, node: string): string => {
  const place = path.join(path.dirname(root), `ork-r1-${node}`);
  sh(root, "worktree", "add", "--quiet", "-b", `ork/r1/${node}`, place);
  record(root, node, place);
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
  items: await listOrkWorktrees(root, recorded.get(root) ?? []),
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
    record(root, "docs", "", "r2");
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

  it("changes only its own item, leaving another missing worktree as it was", async () => {
    const root = repo();
    const lead = worktree(root, "lead");
    const docs = worktree(root, "docs");
    rmSync(docs, { recursive: true });
    expect(
      await applyRemove(root, planned(await read(root), "ork/r1/lead")),
    ).toEqual([`removed ${lead}`]);
    expect(
      (await read(root)).items.map(i => [i.branch, i.path, i.missing]),
    ).toEqual([
      ["ork/r1/lead", null, false],
      ["ork/r1/docs", docs, true],
    ]);
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

/** `git worktree list --porcelain`'s paths, as git still records them. */
const gitWorktrees = (root: string): string[] =>
  sh(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length));

describe("a branch no run recorded", () => {
  it("is listed as not created by Ork, and kept by clean and remove", async () => {
    const root = repo();
    sh(root, "branch", "ork/manual-keep");
    const found = await read(root);
    expect(found.items.map(i => [i.branch, i.recorded])).toEqual([
      ["ork/manual-keep", false],
    ]);
    expect(stateParts(firstOf(found.items))).toContainEqual({
      text: "not created by Ork",
      risk: false,
    });
    const steps = planClean(
      found.items,
      { merged: false },
      { branches: true, force: true },
    );
    expect(steps.map(s => [s.removeWorktree, s.deleteBranch, s.skip])).toEqual([
      [false, false, "not created by Ork"],
    ]);
    expect(await applyClean(root, steps, true)).toEqual([]);
    expect(planRemove(found, "ork/manual-keep", true)).toEqual({
      ok: false,
      gone: false,
      error:
        "Can't remove ork/manual-keep: not created by Ork (no run recorded it); delete it with git if it's yours to delete.",
    });
    expect(sh(root, "branch", "--list", "ork/manual-keep")).toContain(
      "ork/manual-keep",
    );
  });
});

describe("cleaning beside the user's own worktrees", () => {
  it("drops only its own missing worktree, never one of the user's", async () => {
    const root = repo();
    const lead = worktree(root, "lead");
    const mine = path.join(path.dirname(root), "mine");
    sh(root, "worktree", "add", "--quiet", "-b", "mine", mine);
    rmSync(lead, { recursive: true });
    rmSync(mine, { recursive: true });
    const steps = planClean(
      (await read(root)).items,
      { merged: false },
      { branches: true, force: false },
    );
    expect(await applyClean(root, steps, false)).toEqual([
      `pruned ${lead}`,
      "deleted ork/r1/lead",
    ]);
    expect(gitWorktrees(root)).toEqual([root, mine]);
  });

  it("leaves a recorded branch alone in a worktree Ork didn't create", async () => {
    const root = repo();
    const lead = worktree(root, "lead");
    sh(root, "worktree", "remove", lead);
    const review = path.join(path.dirname(root), "review");
    sh(root, "worktree", "add", "--quiet", review, "ork/r1/lead");
    const items = await listOrkWorktrees(root, [
      { runId: "r1", nodeId: "lead", path: lead, branch: "ork/r1/lead" },
    ]);
    expect(items.map(i => [i.path, i.heldBy, stateParts(i)])).toEqual([
      [
        null,
        review,
        [
          { text: "no worktree", risk: false },
          { text: `checked out in ${review}`, risk: false },
        ],
      ],
    ]);
    const steps = planClean(
      items,
      { merged: false },
      { branches: true, force: true },
    );
    expect(steps.map(s => [s.removeWorktree, s.deleteBranch, s.skip])).toEqual([
      [false, false, `checked out in ${review}`],
    ]);
    expect(await applyClean(root, steps, true)).toEqual([]);
    expect(existsSync(review)).toBe(true);
    expect(
      planRemove({ items, live: new Set() }, "ork/r1/lead", true),
    ).toMatchObject({
      ok: false,
      error: `Can't remove ork/r1/lead: checked out in ${review}, a worktree Ork didn't create; switch it to another branch first.`,
    });
  });

  it("still finds a recorded branch checked out in the main checkout", async () => {
    const root = repo();
    const lead = worktree(root, "lead");
    sh(root, "worktree", "remove", lead);
    sh(root, "switch", "--quiet", "ork/r1/lead");
    const items = await listOrkWorktrees(root, [
      { runId: "r1", nodeId: "lead", path: lead, branch: "ork/r1/lead" },
    ]);
    expect(items.map(i => [i.path, i.inMainCheckout, i.heldBy])).toEqual([
      [null, true, undefined],
    ]);
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
    recorded: true,
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
