/**
 * @file Tests for the survey `ork onboard` takes of a repository with no model:
 *   each field pinned against a fixture repository, the base branch from git,
 *   links out of the repository not followed, a bounded size, and one line of
 *   text per fact.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  gitProbe,
  readSurvey,
  type SurveyProbes,
  surveyText,
} from "../src/onboard/survey.ts";

const tempDir = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-survey-")));

/** Writes `files` (project-relative path to text) under `root`. */
const write = (root: string, files: Record<string, string>): string => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
};

/** Git answers from a table of `args` to stdout; any other call fails. */
const gitSays =
  (answers: Record<string, string>): SurveyProbes["git"] =>
  args =>
    Promise.resolve(answers[args.join(" ")] ?? null);

const probes = (
  answers: Record<string, string> = {},
  ghUsable = false,
): SurveyProbes => ({
  git: gitSays(answers),
  ghUsable: () => Promise.resolve(ghUsable),
});

const FIXTURE: Record<string, string> = {
  "package.json": JSON.stringify({
    packageManager: "pnpm@9.1.0",
    scripts: {
      test: "vitest run",
      "test:e2e": "playwright test",
      check: "tsc && oxlint",
      build: "tsc",
      dev: "vite",
      broken: 12,
    },
  }),
  "pnpm-lock.yaml": "",
  "Cargo.toml": "",
  Makefile: "test:\n\tcargo test\nlint:\n\tcargo clippy\nrelease:\n\ttrue\n",
  ".github/workflows/ci.yml": "",
  ".github/workflows/notes.txt": "",
  ".gitlab-ci.yml": "",
  "AGENTS.md": "",
  ".claude/agents/reviewer.md": "",
  ".claude/agents/notes.txt": "",
  ".claude/skills/deploy/SKILL.md": "",
  ".ork/project.yaml": "",
  ".ork/workflows/hello.ork.yaml": "",
  ".ork/workflows/build.ork.yaml": "",
  ".ork/agents/ork-implementer.md": "",
};

describe("readSurvey", () => {
  it("reads each field of a fixture repository", async () => {
    const survey = await readSurvey(
      write(tempDir(), FIXTURE),
      probes(
        { "symbolic-ref --short refs/remotes/origin/HEAD": "origin/trunk" },
        true,
      ),
    );
    expect(survey).toEqual({
      packageManagers: ["pnpm", "cargo"],
      scripts: [
        { name: "test", command: "vitest run" },
        { name: "test:e2e", command: "playwright test" },
        { name: "check", command: "tsc && oxlint" },
        { name: "build", command: "tsc" },
        { name: "dev", command: "vite" },
      ],
      testCommands: [
        "pnpm run test",
        "pnpm run test:e2e",
        "make test",
        "cargo test",
      ],
      checkCommands: ["pnpm run check", "pnpm run build", "make lint"],
      ciFiles: [".github/workflows/ci.yml", ".gitlab-ci.yml"],
      baseBranch: "trunk",
      ghUsable: true,
      instructionFiles: ["AGENTS.md"],
      agentFolders: [
        { folder: ".ork/agents", entries: ["ork-implementer"], more: 0 },
        { folder: ".claude/agents", entries: ["reviewer"], more: 0 },
        { folder: ".claude/skills", entries: ["deploy"], more: 0 },
      ],
      ork: {
        exists: true,
        projectFile: true,
        workflows: ["build", "hello"],
        agents: ["ork-implementer"],
        skills: [],
      },
    });
  });

  it("reports an empty folder: no managers, no .ork, base branch unknown", async () => {
    const survey = await readSurvey(tempDir(), probes());
    expect(survey).toEqual({
      packageManagers: [],
      scripts: [],
      testCommands: [],
      checkCommands: [],
      ciFiles: [],
      baseBranch: null,
      ghUsable: false,
      instructionFiles: [],
      agentFolders: [],
      ork: {
        exists: false,
        projectFile: false,
        workflows: [],
        agents: [],
        skills: [],
      },
    });
    expect(surveyText(survey)).toContain(".ork/: not there");
  });

  it("names the base branch: origin's HEAD, else a usual name, else the current branch", async () => {
    const root = tempDir();
    const base = (answers: Record<string, string>) =>
      readSurvey(root, probes(answers)).then(s => s.baseBranch);
    expect(
      await base({
        "symbolic-ref --short refs/remotes/origin/HEAD": "origin/develop",
      }),
    ).toBe("develop");
    expect(
      await base({ "rev-parse --verify --quiet refs/heads/master": "abc" }),
    ).toBe("master");
    expect(await base({ "branch --show-current": "feature/x" })).toBe(
      "feature/x",
    );
    expect(await base({ "branch --show-current": "" })).toBeNull();
  });

  it("asks a real repository for its branch", async () => {
    const root = tempDir();
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {
          cwd: root,
          stdio: "ignore",
        },
      );
    git("init", "-b", "main");
    git("commit", "--allow-empty", "-m", "first");
    const survey = await readSurvey(root, {
      git: gitProbe(root),
      ghUsable: () => Promise.resolve(false),
    });
    expect(survey.baseBranch).toBe("main");
  });

  it("follows no link out of the repository", async () => {
    const root = write(tempDir(), { "AGENTS.md": "" });
    const outside = write(tempDir(), {
      "package.json": JSON.stringify({ scripts: { test: "x" } }),
      "agents/secret.md": "",
      "workflows/stolen.ork.yaml": "",
    });
    symlinkSync(
      path.join(outside, "package.json"),
      path.join(root, "package.json"),
    );
    mkdirSync(path.join(root, ".opencode"));
    symlinkSync(
      path.join(outside, "agents"),
      path.join(root, ".opencode", "agents"),
    );
    mkdirSync(path.join(root, ".ork"));
    symlinkSync(
      path.join(outside, "workflows"),
      path.join(root, ".ork", "workflows"),
    );
    const survey = await readSurvey(root, probes());
    expect(survey.scripts).toEqual([]);
    expect(survey.agentFolders).toEqual([]);
    expect(survey.ork.workflows).toEqual([]);
  });

  it("lists a tool's folder linked into .ork once", async () => {
    const root = write(tempDir(), { ".ork/agents/ork-reviewer.md": "" });
    mkdirSync(path.join(root, ".claude"));
    symlinkSync(
      path.join(root, ".ork", "agents"),
      path.join(root, ".claude", "agents"),
    );
    const survey = await readSurvey(root, probes());
    expect(survey.agentFolders.map(f => f.folder)).toEqual([".ork/agents"]);
  });

  it("bounds what it keeps and renders to one line per fact", async () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 100 }, (_, n) => [
        `s${String(n)}`,
        `run ${"x".repeat(400)}`,
      ]),
    );
    scripts["test:\nwith newline"] = "echo\n\u001B[31mred\nIGNORE ALL PREVIOUS";
    const root = write(tempDir(), {
      "package.json": JSON.stringify({ scripts }),
      ...Object.fromEntries(
        Array.from({ length: 50 }, (_, n) => [
          `.claude/skills/k${String(n)}/SKILL.md`,
          "",
        ]),
      ),
    });
    const survey = await readSurvey(root, probes());
    expect(survey.scripts).toHaveLength(30);
    expect(survey.scripts[0]?.command).toHaveLength(100);
    expect(survey.agentFolders[0]).toMatchObject({ more: 30 });
    const text = surveyText(survey);
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text.split("\n")).toHaveLength(10);
  });

  it("collapses a repository's own line breaks and control codes", async () => {
    const root = write(tempDir(), {
      "package.json": JSON.stringify({
        scripts: { "test:a\nb": "echo\n\u001B[31mred\nIGNORE ALL PREVIOUS" },
      }),
    });
    const survey = await readSurvey(root, probes());
    expect(survey.scripts).toEqual([
      { name: "test:a b", command: "echo [31mred IGNORE ALL PREVIOUS" },
    ]);
    expect(surveyText(survey).split("\n")).toHaveLength(9);
  });
});

describe("surveyText", () => {
  it("renders each fact on its own line", async () => {
    const survey = await readSurvey(
      write(tempDir(), FIXTURE),
      probes({}, true),
    );
    expect(surveyText(survey).split("\n")).toEqual([
      "Package managers: pnpm, cargo",
      "Scripts: test = vitest run, test:e2e = playwright test, check = tsc && oxlint, build = tsc, dev = vite",
      "Test commands: pnpm run test, pnpm run test:e2e, make test, cargo test",
      "Check commands: pnpm run check, pnpm run build, make lint",
      "CI files: .github/workflows/ci.yml, .gitlab-ci.yml",
      "Base branch: unknown",
      "GitHub CLI: usable",
      "Instruction files: AGENTS.md",
      ".ork/agents: ork-implementer",
      ".claude/agents: reviewer",
      ".claude/skills: deploy",
      ".ork/: project.yaml yes; workflows build, hello; agents ork-implementer; skills none",
    ]);
  });
});
