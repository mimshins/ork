/**
 * @file Tests for the list flags of `ork worktrees list`, `ork agents list` and
 *   `ork projects` (RFC-017), through the real CLI in a temp repository with
 *   its own `~`: `--ids`, `--limit`, `--json` and the filters, and the tables
 *   the flags come from.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadAgents,
  openStore,
  type ProjectRecord,
  storePath,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { agentListTable } from "../src/agents/table.ts";
import { projectListTable } from "../src/commands/projects.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** A repo with a worktree on `ork/r1/lead` that run r1 recorded, and a `~`. */
const place = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-list-cli-")));
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
  const store = openStore(storePath(home));
  store.begin({ id: "r1", workflow: "w", file: "/w.ork.yaml", project: root });
  store.append("r1", {
    type: "worktree",
    id: "lead",
    action: "created",
    path: lead,
    branch: "ork/r1/lead",
  });
  store.addProject({ id: "app", root, mode: "attached", dir: root });
  store.close();
  return { home, root };
};

const ork = (where: { home: string; root: string }, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: where.root,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: where.home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

describe("ork worktrees list", () => {
  const where = place();

  it("prints the key `remove` takes with --ids", () => {
    expect(ork(where, "worktrees", "list", "--ids").stdout).toBe(
      "ork/r1/lead\n",
    );
    expect(ork(where, "worktrees", "--ids").stdout).toBe("ork/r1/lead\n");
  });

  it("filters by --run, and prints nothing for no match", () => {
    expect(ork(where, "worktrees", "list", "--run", "r1", "--ids").stdout).toBe(
      "ork/r1/lead\n",
    );
    const none = ork(where, "worktrees", "list", "--run", "r9", "--ids");
    expect(none.stdout).toBe("");
    expect(none.status).toBe(0);
  });

  it("scopes by --project: all, a registered id, and an unknown one", () => {
    expect(
      ork(where, "worktrees", "list", "--project", "all", "--ids").stdout,
    ).toBe("ork/r1/lead\n");
    expect(
      ork(where, "worktrees", "list", "--project", "app", "--ids").stdout,
    ).toBe("ork/r1/lead\n");
    const bad = ork(where, "worktrees", "list", "--project", "nope");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(
      "No registered project `nope`; registered: app",
    );
  });

  it("refuses --ids with --json and a bad --limit", () => {
    const both = ork(where, "worktrees", "list", "--ids", "--json");
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("--ids and --json can't be used together.");
    for (const limit of ["0", "-1", "abc", "2.5"]) {
      const bad = ork(where, "worktrees", "list", "--limit", limit);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("--limit takes a positive whole number");
    }
  });

  it("skips a registered folder that is no longer a repository, with a warning", () => {
    const mine = place();
    const gone = path.join(path.dirname(mine.root), "plain");
    mkdirSync(gone);
    const store = openStore(storePath(mine.home));
    store.addProject({ id: "plain", root: gone, mode: "attached", dir: gone });
    store.close();
    const listed = ork(mine, "worktrees", "list", "--project", "all", "--ids");
    expect(listed.status).toBe(0);
    expect(listed.stdout).toBe("ork/r1/lead\n");
    expect(listed.stderr).toContain(`Skipped ${gone}: `);
    expect(listed.stderr).toContain("not a git repository");
  });

  it("--limit cuts the list", () => {
    const mine = place();
    const second = path.join(path.dirname(mine.root), "ork-r1-two");
    git(mine.root, "worktree", "add", "--quiet", "-b", "ork/r1/two", second);
    const store = openStore(storePath(mine.home));
    store.append("r1", {
      type: "worktree",
      id: "two",
      action: "created",
      path: second,
      branch: "ork/r1/two",
    });
    store.close();
    expect(
      ork(mine, "worktrees", "list", "--ids").stdout.trim().split(","),
    ).toHaveLength(2);
    expect(
      ork(mine, "worktrees", "list", "--ids", "--limit", "1")
        .stdout.trim()
        .split(","),
    ).toHaveLength(1);
  });

  it("keeps --json and --limit working", () => {
    const json = ork(where, "worktrees", "list", "--json", "--limit", "1");
    expect(JSON.parse(json.stdout)).toHaveLength(1);
  });
});

describe("ork agents list", () => {
  const where = place();
  mkdirSync(path.join(where.root, ".claude/agents"), { recursive: true });
  writeFileSync(
    path.join(where.root, ".claude/agents/mine.md"),
    "---\nname: mine\n---\n\nHelp.\n",
  );

  it("filters by --source and prints names with --ids", () => {
    expect(
      ork(where, "agents", "list", "--source", "project", "--ids").stdout,
    ).toBe("mine\n");
    const builtin = ork(
      where,
      "agents",
      "list",
      "--source",
      "builtin",
      "--ids",
    );
    expect(builtin.stdout.trim().split(",").length).toBeGreaterThan(1);
    expect(builtin.stdout).not.toContain("mine");
  });

  it("refuses a wrong --source, naming the flag and the values", () => {
    const bad = ork(where, "agents", "list", "--source", "cloud");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("--source");
    expect(bad.stderr).toContain("builtin");
  });

  it("applies --limit and refuses --ids with --json", () => {
    expect(
      ork(where, "agents", "list", "--ids", "--limit", "1").stdout.trim(),
    ).not.toContain(",");
    expect(ork(where, "agents", "list", "--ids", "--json").status).toBe(1);
  });
});

describe("ork projects", () => {
  const where = place();

  it("prints project ids, limited", () => {
    expect(ork(where, "projects", "--ids").stdout).toBe("app\n");
    expect(ork(where, "projects", "--ids", "--limit", "1").stdout).toBe(
      "app\n",
    );
    expect(ork(where, "projects", "--limit", "0").status).toBe(1);
    expect(ork(where, "projects", "--ids", "--json").status).toBe(1);
  });

  it("--limit cuts the list of projects", () => {
    const mine = place();
    const store = openStore(storePath(mine.home));
    store.addProject({ id: "zed", root: "/z", mode: "attached", dir: "/z" });
    store.close();
    expect(
      ork(mine, "projects", "--ids").stdout.trim().split(","),
    ).toHaveLength(2);
    expect(
      ork(mine, "projects", "--ids", "--limit", "1").stdout.trim().split(","),
    ).toHaveLength(1);
  });

  it("has no filter flags, only --ids, --limit and --json", () => {
    expect(projectListTable.fields).toEqual([]);
    const record = {
      id: "a",
      root: "/a",
      mode: "attached",
      dir: "/d",
      registeredAt: "",
    } satisfies ProjectRecord;
    expect(projectListTable.id?.(record)).toBe("a");
  });
});

describe("the agents table", () => {
  it("has --source as an enum of the catalog's sources, and names as ids", () => {
    const [source] = agentListTable.fields;
    expect(source?.values).toEqual(["builtin", "user", "project"]);
    const names = loadAgents({ home: place().home }).agents.map(agent =>
      agentListTable.id?.(agent),
    );
    expect(names).toContain("ork-reviewer");
  });
});
