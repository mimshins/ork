/**
 * @file Tests for `ork worktrees remove` and the live-run rule, for real, in a
 *   temp repository with its own `~`: removing one worktree that loses work
 *   shows what's lost and needs `--force`; a branch with no worktree is
 *   deleted; `clean` refuses a name; a detached one goes by the run/node name
 *   `list` shows; and neither clean nor remove touches a worktree whose run is
 *   still going.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** Records run `id` creating these worktrees; finished unless `running`. */
const recordRun = (
  home: string,
  root: string,
  id: string,
  created: { node: string; path: string; branch?: string }[],
  running = false,
): void => {
  const store = openStore(storePath(home));
  store.begin({ id, workflow: "w", file: "/w.ork.yaml", project: root });
  for (const { node, path: folder, branch } of created) {
    store.append(id, {
      type: "worktree",
      id: node,
      action: "created",
      path: folder,
      ...(branch === undefined ? {} : { branch }),
    });
  }
  if (!running) {
    store.append(id, {
      type: "run.finished",
      result: {
        runId: id,
        status: "succeeded",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
  }
  store.close();
};

/**
 * A repo with one commit, a worktree on `ork/r1/lead` that run r1 recorded
 * (still going when `running`), and its own `~`.
 */
const place = (running = false) => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-wt-cli-")));
  const home = path.join(base, "home");
  const root = path.join(base, "app");
  mkdirSync(home);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "dev@example.com");
  git(root, "config", "user.name", "Dev");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, "a.ts"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const lead = path.join(base, "ork-r1-lead");
  git(root, "worktree", "add", "--quiet", "-b", "ork/r1/lead", lead);
  recordRun(
    home,
    root,
    "r1",
    [{ node: "lead", path: lead, branch: "ork/r1/lead" }],
    running,
  );
  return { home, root, lead };
};

const ork = (where: ReturnType<typeof place>, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, "worktrees", ...args], {
    cwd: where.root,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: where.home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

describe("ork worktrees remove", () => {
  it("shows what's lost and needs --force to lose it", () => {
    const where = place();
    writeFileSync(path.join(where.lead, "wip.ts"), "wip\n");
    const refused = ork(where, "remove", "ork/r1/lead", "--yes");
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("ork/r1/lead: remove worktree");
    expect(refused.stdout).toContain("Uncommitted changes:\n  ?? wip.ts");
    expect(refused.stderr).toContain("pass --force");
    expect(existsSync(where.lead)).toBe(true);
    const forced = ork(where, "remove", where.lead, "--force", "--yes");
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain(`removed ${where.lead}`);
    expect(existsSync(where.lead)).toBe(false);
  });

  it("deletes a branch with no worktree", () => {
    const where = place();
    git(where.root, "branch", "ork/r2/docs");
    recordRun(where.home, where.root, "r2", [
      { node: "docs", path: "", branch: "ork/r2/docs" },
    ]);
    const removed = ork(where, "remove", "ork/r2/docs", "--yes");
    expect(removed.stdout).toContain("deleted ork/r2/docs");
    expect(git(where.root, "branch", "--list", "ork/r2/docs")).toBe("");
  });
});

describe("a detached worktree", () => {
  it("is removed by the run/node name list shows", () => {
    const where = place();
    const build = path.join(path.dirname(where.root), "ork-r3-build");
    git(where.root, "worktree", "add", "--quiet", "--detach", build);
    writeFileSync(path.join(build, "kept.ts"), "kept\n");
    const store = openStore(storePath(where.home));
    store.begin({
      id: "r3",
      workflow: "w",
      file: "/w.ork.yaml",
      project: where.root,
    });
    store.append("r3", {
      type: "worktree",
      id: "build",
      action: "created",
      path: build,
    });
    store.append("r3", {
      type: "run.finished",
      result: {
        runId: "r3",
        status: "succeeded",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    store.close();
    expect(ork(where, "list").stdout).toContain("r3/build (detached)");
    const removed = ork(where, "remove", "r3/build", "--force", "--yes");
    expect(removed.status).toBe(0);
    expect(existsSync(build)).toBe(false);
  });
});

describe("a clean detached worktree on the current branch", () => {
  it("is planned for removal by clean without --all", () => {
    const where = place();
    const build = path.join(path.dirname(where.root), "ork-r5-build");
    git(where.root, "worktree", "add", "--quiet", "--detach", build);
    recordRun(where.home, where.root, "r5", [{ node: "build", path: build }]);
    const out = ork(where, "clean", "--run", "r5", "--yes");
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("r5/build (detached): remove worktree");
    expect(out.stdout).not.toContain("Nothing to clean");
    expect(existsSync(build)).toBe(false);
  });
});

describe("a fanned node's item worktrees", () => {
  it("are listed by item id, and one is removed by its listed name", () => {
    const where = place();
    const items = [1, 2].map(at => {
      const folder = path.join(
        path.dirname(where.root),
        `ork-r4-build.${String(at)}`,
      );
      git(where.root, "worktree", "add", "--quiet", "--detach", folder);
      return folder;
    });
    const store = openStore(storePath(where.home));
    store.begin({
      id: "r4",
      workflow: "w",
      file: "/w.ork.yaml",
      project: where.root,
    });
    for (const [at, folder] of items.entries()) {
      store.append("r4", {
        type: "worktree",
        id: `build.${String(at + 1)}`,
        action: "created",
        path: folder,
      });
    }
    store.append("r4", {
      type: "run.finished",
      result: {
        runId: "r4",
        status: "succeeded",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    store.close();
    const listed = ork(where, "list").stdout;
    expect(listed).toContain("r4/build.1 (detached)");
    expect(listed).toContain("r4/build.2 (detached)");
    const removed = ork(where, "remove", "r4/build.2", "--force", "--yes");
    expect(removed.status).toBe(0);
    expect(items.map(folder => existsSync(folder))).toEqual([true, false]);
  });
});

describe("a branch no run recorded", () => {
  it("is listed as not created by Ork, and clean and remove keep it", () => {
    const where = place();
    git(where.root, "branch", "ork/manual-keep");
    expect(ork(where, "list").stdout).toContain(
      "ork/manual-keep  merged · no worktree · not created by Ork",
    );
    const clean = ork(
      where,
      "clean",
      "--branches",
      "--all",
      "--force",
      "--yes",
    );
    expect(clean.stdout).toContain(
      "ork/manual-keep: keep (not created by Ork)",
    );
    expect(git(where.root, "branch", "--list", "ork/manual-keep")).toContain(
      "ork/manual-keep",
    );
    const remove = ork(where, "remove", "ork/manual-keep", "--force", "--yes");
    expect(remove.status).toBe(1);
    expect(remove.stderr).toContain("not created by Ork");
    expect(git(where.root, "branch", "--list", "ork/manual-keep")).toContain(
      "ork/manual-keep",
    );
  });
});

describe("ork worktrees clean", () => {
  it("rejects a name and points to remove, planning nothing", () => {
    const where = place();
    const out = ork(where, "clean", "r1/lead", "--force", "--yes");
    expect(out.status).toBe(1);
    expect(out.stderr).toContain(
      "`clean` takes no name (got r1/lead); to remove one worktree: ork worktrees remove r1/lead",
    );
    expect(out.stdout).toBe("");
    expect(existsSync(where.lead)).toBe(true);
  });

  it("does not read the value of --run as a name", () => {
    const where = place();
    const out = ork(where, "clean", "--run", "r1", "--all", "--yes");
    expect(out.status).toBe(0);
    expect(out.stderr).not.toContain("takes no name");
    expect(existsSync(where.lead)).toBe(false);
  });
});

describe("ork worktrees clean --run", () => {
  it("names a run the project doesn't have, and plans nothing", () => {
    const where = place();
    const out = ork(where, "clean", "--run", "nosuch", "--yes");
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("No run nosuch in this project.");
    expect(out.stdout).toBe("");
  });

  it("says nothing to clean only for a run with nothing left", () => {
    const where = place();
    recordRun(where.home, where.root, "r5", []);
    const out = ork(where, "clean", "--run", "r5", "--yes");
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("Nothing to clean.\n");
  });
});

describe("ork worktrees remove <path>", () => {
  it("finds a worktree by a symlinked path", () => {
    const where = place();
    const link = path.join(path.dirname(where.root), "link-to-lead");
    symlinkSync(where.lead, link);
    const removed = ork(where, "remove", link, "--yes");
    expect(removed.status).toBe(0);
    expect(existsSync(where.lead)).toBe(false);
  });
});

describe("ork worktrees in a repo with no commit", () => {
  it("lists nothing, and exits 0", () => {
    const where = place();
    const bare = path.join(path.dirname(where.root), "bare");
    mkdirSync(bare);
    git(bare, "init", "-q", "-b", "main");
    const out = ork({ ...where, root: bare });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("No Ork worktrees or branches.\n");
    expect(ork({ ...where, root: bare }, "clean", "--yes").status).toBe(1);
  });
});

describe("ork worktrees clean --force", () => {
  it("lists what each item would lose before it asks, and so before --yes", () => {
    const where = place();
    git(where.lead, "config", "user.email", "dev@example.com");
    git(where.lead, "config", "user.name", "Dev");
    writeFileSync(path.join(where.lead, "done.ts"), "done\n");
    git(where.lead, "add", "-A");
    git(where.lead, "commit", "-q", "-m", "add done");
    writeFileSync(path.join(where.lead, "wip.ts"), "wip\n");
    const out = ork(where, "clean", "--all", "--branches", "--force", "--yes");
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(
      /Plan:\n {2}ork\/r1\/lead: remove worktree \+ delete branch\nLoses in ork\/r1\/lead:\nUncommitted changes:\n {2}\?\? wip.ts\nCommits not merged:\n {2}\w+ add done\n/u,
    );
    expect(existsSync(where.lead)).toBe(false);
  });

  it("says nothing of losses when nothing is lost", () => {
    const where = place();
    const out = ork(where, "clean", "--all", "--force", "--yes");
    expect(out.stdout).not.toContain("Loses in");
  });
});

describe("a run still going", () => {
  it("keeps its worktree from clean --force and from remove", () => {
    // This process stands in for the run's, so the run is alive.
    const where = place(true);
    const clean = ork(where, "clean", "--all", "--force", "--yes");
    expect(clean.stdout).toContain(
      "ork/r1/lead: keep (its run is still going)",
    );
    expect(clean.stdout).not.toContain("Nothing to clean.");
    const remove = ork(where, "remove", "ork/r1/lead", "--force", "--yes");
    expect(remove.stderr).toContain("run r1 is still going; stop it first");
    expect(existsSync(where.lead)).toBe(true);
  });
});
