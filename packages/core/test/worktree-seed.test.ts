/**
 * @file Tests of seeding a worktree (RFC-022 option D): the named plain files
 *   of a folder outside the repository are committed once into a new, detached
 *   worktree, with no commit hook and past `.gitignore`, at a subfolder prefix
 *   too; links, paths that leave a folder and missing files are skipped; a
 *   workspace reports the seed commit as the node's `seed` output, records it
 *   on the `created` event, and never seeds a worktree it opens again, in the
 *   same run or a resumed one.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWorkspace,
  createWorktree,
  type RunEvent,
  resumedOptions,
  resumeState,
  type WorktreeSeed,
} from "../src/index.ts";
import { compile, repo, sh, write } from "./fixtures/git.ts";

const WORKFLOW = "workflows/check.ork.yaml";
const RULES = "project.yaml";

/** An attached project's Ork folder, outside any repository. */
const orkFolder = (): string => {
  const from = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-seed-")));
  write(from, WORKFLOW, "name: check\n");
  write(from, RULES, "schemaVersion: 1\n");
  return from;
};

const seedOf = (from: string, more: Partial<WorktreeSeed> = {}) => ({
  from,
  to: ".ork",
  paths: [WORKFLOW, RULES],
  ...more,
});

const headOf = (cwd: string): string => sh(cwd, "rev-parse", "HEAD").trim();

const filesAt = (cwd: string, ref: string): string[] =>
  sh(cwd, "ls-tree", "-r", "--name-only", ref).trim().split("\n");

/** A new worktree of a fresh repo beside it, seeded with `seed`. */
const seeded = async (seed: (from: string) => WorktreeSeed, root = repo()) => {
  const from = orkFolder();
  const base = headOf(root);
  const created = await createWorktree({
    root,
    path: path.join(path.dirname(root), "child"),
    branch: "ork/r1/write",
    base,
    seed: seed(from),
  });
  return { root, from, base, created };
};

describe("a seeded worktree", () => {
  it("commits the files once, detached, and HEAD is the seed commit", async () => {
    const { root, base, created, from } = await seeded(seedOf);
    expect(created.branch).toBeUndefined();
    expect(created.seed).toBe(headOf(created.path));
    expect(sh(created.path, "branch", "--show-current").trim()).toBe("");
    expect(sh(created.path, "rev-parse", "HEAD~1").trim()).toBe(base);
    expect(sh(created.path, "diff", "--name-only", base, "HEAD").trim()).toBe(
      [".ork/project.yaml", ".ork/workflows/check.ork.yaml"].join("\n"),
    );
    expect(
      readFileSync(path.join(created.path, ".ork", WORKFLOW), "utf8"),
    ).toBe(readFileSync(path.join(from, WORKFLOW), "utf8"));
    expect(sh(created.path, "status", "--porcelain")).toBe("");
    expect(sh(root, "branch", "--list", "ork/*")).toBe("");
  });

  it("runs no commit hook", async () => {
    const root = repo();
    const marker = path.join(path.dirname(root), "hook-ran");
    for (const hook of ["pre-commit", "commit-msg", "post-commit"]) {
      write(
        root,
        `.git/hooks/${hook}`,
        `#!/bin/sh\ntouch "${marker}"\nexit 1\n`,
      );
      chmodSync(path.join(root, ".git/hooks", hook), 0o755);
    }
    const { created } = await seeded(seedOf, root);
    expect(filesAt(created.path, "HEAD")).toContain(".ork/project.yaml");
    expect(existsSync(marker)).toBe(false);
  });

  it("commits the files when .ork is gitignored", async () => {
    const root = repo();
    write(root, ".gitignore", ".ork/\n");
    sh(root, "commit", "-qam", "ignore .ork");
    const { created } = await seeded(seedOf, root);
    expect(filesAt(created.path, "HEAD")).toContain(
      ".ork/workflows/check.ork.yaml",
    );
  });

  it("seeds at a subfolder project's prefix", async () => {
    const { created } = await seeded(from => seedOf(from, { to: "src/.ork" }));
    expect(filesAt(created.path, "HEAD")).toEqual(
      expect.arrayContaining([
        "src/.ork/project.yaml",
        "src/.ork/workflows/check.ork.yaml",
      ]),
    );
  });

  it("skips links, paths out of the folder, and missing files", async () => {
    const outside = path.join(orkFolder(), RULES);
    const { base, created } = await seeded(from => {
      symlinkSync(outside, path.join(from, "workflows/linked.ork.yaml"));
      mkdirSync(path.join(from, "elsewhere"));
      write(from, "elsewhere/behind.ork.yaml", "name: behind\n");
      symlinkSync(path.join(from, "elsewhere"), path.join(from, "linked"));
      return seedOf(from, {
        paths: [
          WORKFLOW,
          "workflows/linked.ork.yaml",
          "linked/behind.ork.yaml",
          "../outside.ork.yaml",
          outside,
          "workflows/missing.ork.yaml",
        ],
      });
    });
    expect(sh(created.path, "diff", "--name-only", base, "HEAD").trim()).toBe(
      ".ork/workflows/check.ork.yaml",
    );
  });

  it("refuses a seed folder that leaves the worktree or is a link, and leaves no worktree", async () => {
    const root = repo();
    symlinkSync("..", path.join(root, ".ork"));
    sh(root, "add", ".ork");
    sh(root, "commit", "-qm", "link .ork");
    await expect(seeded(seedOf, root)).rejects.toThrow("is a link");
    await expect(
      seeded(from => seedOf(from, { to: "../out" })),
    ).rejects.toThrow("leaves the worktree");
    expect(sh(root, "worktree", "list", "--porcelain")).not.toContain("child");
  });

  it("seeds nothing from a missing folder, and HEAD stays the base", async () => {
    const { base, created } = await seeded(from =>
      seedOf(path.join(from, "gone")),
    );
    expect(created.seed).toBe(base);
    expect(headOf(created.path)).toBe(base);
    expect(created.branch).toBeUndefined();
  });
});

const GRAPH = compile(`schemaVersion: 1
name: seeded
nodes:
  write:
    type: agent.worker
    prompt: Write.
    isolation: worktree
`);

/** A workspace of GRAPH in `root`, seeded from `from`, recording its events. */
const workspaceOf = (root: string, from: string, before?: RunEvent[]) => {
  const events: RunEvent[] = [];
  const workspace = createWorkspace({
    graph: GRAPH,
    runId: "r1",
    root,
    head: headOf(root),
    onEvent: event => {
      events.push(event);
    },
    seed: seedOf(from),
    ...resumedOptions(before === undefined ? undefined : resumeState(before)),
  });
  return { workspace, events };
};

const PASSED = { ok: true, output: { status: "pass", summary: "ok" } };

describe("a seeded workspace", () => {
  it("reports and records the seed commit, and never seeds again", async () => {
    const root = repo();
    const from = orkFolder();
    const first = workspaceOf(root, from);
    const { cwd } = await first.workspace.prepare("write");
    const seed = headOf(cwd);
    expect(sh(cwd, "rev-parse", "HEAD~1").trim()).toBe(headOf(root));
    const done = await first.workspace.finish("write", PASSED);
    expect(done.output["seed"]).toBe(seed);
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "worktree", action: "created", seed }),
    );

    // A later round, with the writer's change in the folder.
    write(cwd, ".ork/workflows/new.ork.yaml", "name: new\n");
    write(from, WORKFLOW, "name: changed\n");
    expect((await first.workspace.prepare("write")).cwd).toBe(cwd);
    expect(headOf(cwd)).toBe(seed);

    // A resumed run adopts the worktree and keeps its seed.
    const again = workspaceOf(root, from, first.events);
    expect((await again.workspace.prepare("write")).cwd).toBe(cwd);
    expect(headOf(cwd)).toBe(seed);
    expect(existsSync(path.join(cwd, ".ork/workflows/new.ork.yaml"))).toBe(
      true,
    );
    expect(readFileSync(path.join(cwd, ".ork", WORKFLOW), "utf8")).toBe(
      "name: check\n",
    );
    const resumed = await again.workspace.finish("write", PASSED);
    expect(resumed.output["seed"]).toBe(seed);
  });
});
