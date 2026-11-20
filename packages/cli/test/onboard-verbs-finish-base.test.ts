/**
 * @file Tests for `ork __onboard finish --base`, the seeded run of an attached
 *   project (RFC-022 option D): the writer's worktree is detached and starts
 *   with one seed commit holding the project's own `.ork/` files, which the
 *   repository's `HEAD` does not. With the seed as the base an existing
 *   workflow's `model`, agents and eye items count as already there and an
 *   unchanged one is not a change; without it `finish` reads `HEAD` as before.
 *   A `--base` that is an option or not a commit is a usage error.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DriverCheck } from "@krapht/ork-integrations";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { changesOf, commitOf, textAtHead } from "../src/onboard/finish-git.ts";
import { finish } from "../src/onboard/verbs-finish.ts";
import { pathWithoutDrivers } from "./fixtures/drivers.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const tempDir = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-finish-base-")));

const put = (root: string, files: Record<string, string>): void => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
};

const workflow = (name: string, extra = "", node = ""): string =>
  `schemaVersion: 1
name: ${name}
limits:
  budgetUsd: 2
  budgetTokens: 400000
${extra}nodes:
  build:
    type: agent.worker
    agent: mine
    prompt: Build it.
${node}`;

const canonical = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return serializeWorkflow(parsed.workflow);
};

/** An existing workflow with its own agent and a default model. */
const EXISTING = workflow(
  "ci",
  "defaults:\n  model: claude-code.sonnet\nagents:\n  mine:\n    instructions: be me\n",
);

const CI = ".ork/workflows/ci.ork.yaml";
const OTHER = ".ork/workflows/other.ork.yaml";

const ready = (): Promise<DriverCheck[]> =>
  Promise.resolve([
    {
      id: "claude-code",
      result: { name: "claude-code", status: "ok" as const, detail: "ready" },
    },
  ]);

type Seeded = { root: string; worktree: string; seed: string };

/**
 * A repository with no `.ork/` and a detached worktree whose one commit past
 * `HEAD` is the seed: the attached project's files, `git add -f`.
 */
const seeded = (files: Record<string, string>, prefix = ""): Seeded => {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  put(root, { [`${prefix}README.md`]: "x\n" });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  const worktree = path.join(tempDir(), "wt");
  git(root, "worktree", "add", "-q", "--detach", worktree);
  put(
    worktree,
    Object.fromEntries(
      Object.entries(files).map(([file, text]) => [`${prefix}${file}`, text]),
    ),
  );
  git(worktree, "add", "-f", ".");
  git(worktree, "commit", "-q", "--no-verify", "-m", "seed");
  return { root, worktree, seed: git(worktree, "rev-parse", "HEAD") };
};

/** `finish` against the seed, or with no base (`null`). */
const check = (scene: Seeded, base: string | null = scene.seed) =>
  finish({
    root: scene.root,
    worktree: scene.worktree,
    branch: "",
    base: base ?? undefined,
    run: "r1",
    checks: ready,
  });

const heavy = (command: string): string =>
  `schemaVersion: 1\nheavy:\n  - ${command}\n`;

describe("finish --base: a seeded run", () => {
  it("keeps the model, agents and eye items of an existing workflow", async () => {
    const scene = seeded({
      [CI]: canonical(EXISTING),
      [OTHER]: canonical(workflow("other")),
    });
    put(scene.worktree, {
      [CI]: EXISTING.replace("Build it.", "Build it well."),
    });
    expect(await check(scene)).toEqual({ problems: [], eye: [] });
  });

  it("lists only the real additions of an edited workflow", async () => {
    const tools = "    tools:\n      allow:\n        - Bash(pnpm test:*)\n";
    const scene = seeded({ [CI]: canonical(workflow("ci", "", tools)) });
    put(scene.worktree, {
      [CI]: workflow("ci", "", `${tools}        - Bash(pnpm lint:*)\n`),
    });
    expect((await check(scene)).eye).toEqual([
      `${CI}: node build allows \`Bash(pnpm lint:*)\``,
    ]);
  });

  it("flags only what the writer adds beyond the seed", async () => {
    const scene = seeded({ [CI]: canonical(EXISTING) });
    put(scene.worktree, {
      [CI]: EXISTING.replace(
        "nodes:\n",
        "nodes:\n  lint:\n    type: agent.worker\n    agent: theirs\n    model: claude-code.opus\n    prompt: Lint it.\n",
      ),
    });
    expect((await check(scene)).problems).toEqual([
      `${CI}: node lint sets \`model\`; leave it to the person running it`,
      `${CI}: node lint uses agent \`theirs\`; use ork-implementer or ork-reviewer`,
      `${CI}: agent.unknown \`lint\` names agent \`theirs\`, which is not defined; known: mine, ork-implementer, ork-reviewer`,
    ]);
  });

  it("reads the project file's eye items against the seed", async () => {
    const scene = seeded({ ".ork/project.yaml": heavy("pnpm check") });
    put(scene.worktree, { ".ork/project.yaml": heavy("pnpm test") });
    expect((await check(scene)).eye).toEqual([
      '.ork/project.yaml: project changes `heavy` to `["pnpm test"]`',
    ]);
  });

  it("has no change for a workflow the writer left alone", () => {
    const scene = seeded({
      [CI]: canonical(EXISTING),
      [OTHER]: canonical(workflow("other")),
    });
    put(scene.worktree, { [CI]: EXISTING.replace("Build it.", "Edited.") });
    expect(changesOf(scene.root, scene.worktree, "", scene.seed)).toEqual([
      { path: CI, kind: "modified" },
    ]);
  });

  it("works for a project in a repository subfolder", async () => {
    const scene = seeded({ [CI]: canonical(EXISTING) }, "sub/");
    put(scene.worktree, {
      [`sub/${CI}`]: EXISTING.replace("Build it.", "Edited."),
    });
    const root = path.join(scene.root, "sub");
    expect(
      await finish({
        root,
        worktree: scene.worktree,
        branch: "",
        base: scene.seed,
        checks: ready,
      }),
    ).toEqual({ problems: [], eye: [] });
  });
});

describe("finish with no base", () => {
  it("reads HEAD, where the seeded workflow is not", async () => {
    const scene = seeded({ [CI]: canonical(EXISTING) });
    put(scene.worktree, {
      [CI]: EXISTING.replace("Build it.", "Build it well."),
    });
    const { problems } = await check(scene, null);
    expect(problems).toContain(
      `${CI}: node build uses agent \`mine\`; use ork-implementer or ork-reviewer`,
    );
  });

  it("reads a file at HEAD as before", () => {
    const scene = seeded({ [CI]: canonical(EXISTING) });
    expect(textAtHead(scene.root, CI)).toBeNull();
    expect(textAtHead(scene.root, CI, scene.seed)).toBe(canonical(EXISTING));
  });
});

const run = (scene: Seeded, ...extra: string[]) =>
  spawnSync(
    process.execPath,
    [
      BIN,
      "__onboard",
      "finish",
      "--worktree",
      scene.worktree,
      "--branch",
      "",
      ...extra,
    ],
    {
      encoding: "utf8",
      cwd: scene.root,
      env: { PATH: pathWithoutDrivers() },
    },
  );

describe("finish --base: the verb", () => {
  it("takes the seed commit", () => {
    const scene = seeded({ [CI]: canonical(EXISTING) });
    put(scene.worktree, { [CI]: EXISTING.replace("Build it.", "Edited.") });
    const out = run(scene, `--base=${scene.seed}`);
    expect(out.stdout).toContain("problems:\n- none\n");
  });

  it.each(["--upload-pack=x", "", "no-such-commit"])(
    "refuses --base %j with a usage error",
    base => {
      const out = run(seeded({ [CI]: canonical(EXISTING) }), `--base=${base}`);
      expect(out.status).toBe(2);
      expect(out.stderr).toContain("--base is not a commit");
    },
  );

  it("resolves a commit-ish and refuses an option", () => {
    const scene = seeded({ [CI]: canonical(EXISTING) });
    expect(commitOf(scene.root, "HEAD")).toBe(
      git(scene.root, "rev-parse", "HEAD"),
    );
    expect(commitOf(scene.root, "-h")).toBeNull();
  });
});
