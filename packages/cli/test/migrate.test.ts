/**
 * @file Tests for `ork migrate` (ADR-036): an attached project moves into its
 *   repository's `.ork/` with its runs, a clash or a live run moves nothing,
 *   `--agents` brings a `.ai/`-style layout under `.ork/` and relinks the
 *   tools' folders, and `--from-agents` drafts a workflow that validates.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  inRepoPlace,
  loadAgents,
  openStore,
  placeFiles,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  applyMigration,
  draftWorkflow,
  loadWorkflow,
  planMigration,
  refusal,
  registerProject,
  writeDraft,
} from "../src/index.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const tmp = (prefix: string) =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const agentFile = (name: string) =>
  `---\nname: ${name}\ndescription: The ${name}.\n---\n\nYou are the ${name}.\n`;

/** A clone with one commit, and whatever `files` it is given committed. */
const clone = (files: Record<string, string> = {}) => {
  const root = path.join(tmp("ork-migrate-"), "app");
  write(path.join(root, "README.md"), "app\n");
  for (const [file, text] of Object.entries(files)) {
    write(path.join(root, file), text);
  }
  git(root, "init", "--quiet");
  git(root, "add", "-A");
  git(
    root,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "base",
  );
  return root;
};

/** An attached project with a workflow, rules and one finished run. */
const attached = (root: string) => {
  const home = tmp("ork-home-");
  const store = openStore(":memory:");
  const result = registerProject(store, root, { home });
  if (!result.ok) throw new Error(result.error);
  const files = placeFiles(result.project);
  write(path.join(files.workflows, "hello.ork.yaml"), "name: hello\n");
  write(files.rules, "schemaVersion: 1\n");
  write(path.join(files.runs, "r1", "events.jsonl"), "{}\n");
  store.begin({
    id: "r1",
    workflow: "hello",
    file: path.join(files.workflows, "hello.ork.yaml"),
    project: root,
  });
  return { store, place: result.project, home };
};

/** The drafted file; throws when drafting failed. */
const draftedFile = (drafted: ReturnType<typeof writeDraft>): string => {
  if (!drafted.ok) throw new Error(drafted.error);
  return drafted.file;
};

/** Where a link points, as written; throws when `at` is not a link. */
const linkAt = (at: string): string => {
  if (!lstatSync(at).isSymbolicLink()) throw new Error(`${at} is no link`);
  return readlinkSync(at);
};

describe("ork migrate", () => {
  it("moves an attached project into .ork/, with its runs, and commits nothing", () => {
    const root = clone();
    const head = git(root, "rev-parse", "HEAD");
    const { store, place } = attached(root);
    store.append("r1", {
      type: "run.finished",
      result: {
        runId: "r1",
        status: "succeeded",
        costUsd: 0,
        nodes: [],
        reasons: [],
        worktrees: [],
      },
    });
    const plan = planMigration(place, { agents: false });
    expect(refusal(plan, store)).toBeUndefined();
    applyMigration(plan, store);

    const files = placeFiles(inRepoPlace(root));
    expect(
      readFileSync(path.join(files.workflows, "hello.ork.yaml"), "utf8"),
    ).toBe("name: hello\n");
    expect(existsSync(path.join(files.runs, "r1", "events.jsonl"))).toBe(true);
    expect(existsSync(place.dir)).toBe(false);
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toContain(
      ".ork/runs/",
    );
    expect(store.projects()).toMatchObject([
      { id: "app", mode: "in-repo", dir: path.join(root, ".ork") },
    ]);
    expect(store.runs()).toMatchObject([
      { id: "r1", file: path.join(files.workflows, "hello.ork.yaml") },
    ]);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "status", "--porcelain", "--untracked-files=all")).toBe(
      "?? .gitignore\n?? .ork/project.yaml\n?? .ork/workflows/hello.ork.yaml\n",
    );
  });

  it("moves nothing on a clash or while a run is live", () => {
    const root = clone({ ".ork/agents/reviewer.md": agentFile("reviewer") });
    const { store, place } = attached(root);
    write(path.join(place.dir, "agents", "reviewer.md"), agentFile("reviewer"));
    const clash = planMigration(place, { agents: false });
    expect(refusal(clash, store)).toContain(".ork/agents/reviewer.md");

    const live = planMigration(
      { ...place, dir: tmp("ork-empty-") },
      { agents: false },
    );
    expect(refusal(live, store)).toContain("r1 is still running");
    expect(existsSync(path.join(place.dir, "workflows"))).toBe(true);
  });

  it("brings a .ai/ layout's agents and skills under .ork/ and relinks the tools", () => {
    const root = clone({
      ".ai/agents/reviewer.md": agentFile("reviewer"),
      ".ai/skills/write-tests/SKILL.md": "---\nname: write-tests\n---\n",
    });
    for (const [at, to] of [
      [".claude/agents", "../.ai/agents"],
      [".claude/skills", "../.ai/skills"],
      [".opencode/agents", "../.ai/agents"],
      [".agents/skills", "../.ai/skills"],
    ] as const) {
      mkdirSync(path.dirname(path.join(root, at)), { recursive: true });
      symlinkSync(to, path.join(root, at));
    }
    const store = openStore(":memory:");
    const plan = planMigration(inRepoPlace(root), { agents: true });
    expect(plan.clashes).toEqual([]);
    applyMigration(plan, store);

    expect(existsSync(path.join(root, ".ork/agents/reviewer.md"))).toBe(true);
    expect(
      existsSync(path.join(root, ".ork/skills/write-tests/SKILL.md")),
    ).toBe(true);
    expect(linkAt(path.join(root, ".ai/agents"))).toBe("../.ork/agents");
    expect(linkAt(path.join(root, ".claude/agents"))).toBe("../.ork/agents");
    expect(linkAt(path.join(root, ".claude/skills"))).toBe("../.ork/skills");
    expect(linkAt(path.join(root, ".agents/skills"))).toBe("../.ork/skills");
    const catalog = loadAgents({ projectRoot: root, home: tmp("ork-home-") });
    expect(catalog.agents.map(a => [a.name, a.where])).toEqual([
      ["reviewer", ".ork/agents/reviewer.md"],
    ]);
    // Run again, there is nothing left to move.
    expect(planMigration(inRepoPlace(root), { agents: true }).steps).toEqual(
      [],
    );
  });

  it("drafts a gated workflow from the project's agents that validates", () => {
    const root = clone({
      ".ork/agents/documenter.md": agentFile("documenter"),
      ".ork/agents/implementer.md": agentFile("implementer"),
      ".ork/agents/reviewer.md": agentFile("reviewer"),
    });
    const home = tmp("ork-home-");
    const place = inRepoPlace(root);
    const catalog = loadAgents({ projectRoot: root, home });
    const options = {
      agents: ["documenter", "implementer"],
      reviewer: "reviewer",
      name: "process",
    };
    const loaded = loadWorkflow(
      draftedFile(writeDraft(place, catalog, options)),
      root,
      home,
      [],
    );
    expect(loaded.report.diagnostics).toEqual([]);
    expect(loaded.workflow?.rules?.git?.commit).toBe("never");
    expect(draftWorkflow(options).edges).toContainEqual({
      from: "reviewer",
      to: "implementer",
      when: "status == 'changes_requested'",
      maxRounds: 3,
    });

    expect(writeDraft(place, catalog, options)).toMatchObject({ ok: false });
    expect(
      writeDraft(place, catalog, { agents: ["builder"], name: "other" }),
    ).toEqual({
      ok: false,
      error:
        "No agent builder; known: documenter, implementer, reviewer (ork agents list).",
    });
  });
});
