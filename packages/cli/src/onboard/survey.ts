/**
 * @file The survey `ork onboard` takes of a repository before any model runs
 *   (specs/cli/onboard.md): package managers, scripts, the test and check
 *   commands, CI files, the base branch, whether `gh` is usable (never a token
 *   or its output), agent and skill folders, and what `.ork/` holds. It reads
 *   plain files only, follows no link out of the repository, is bounded in
 *   size, and renders to one text input for the proposing session, where it is
 *   data and not instructions.
 */

import { execFile } from "node:child_process";

import { gh } from "@krapht/ork-integrations";

import { exec } from "../doctor/checks.ts";
import {
  type AgentFolder,
  agentFoldersOf,
  ciFilesOf,
  insideRoot,
  MAX_NAMES,
  type OrkHolds,
  orkOf,
  readText,
} from "./survey-files.ts";
import { digestLine, type GitDigest, readGitDigest } from "./survey-git.ts";
import { capped, oneLine } from "./text.ts";

const MAX_SCRIPTS = 30;
const MAX_TEXT = 6000;

export type Survey = {
  /** From a lockfile or `packageManager`: `pnpm`, `npm`, `cargo`, `go`… */
  packageManagers: string[];
  /** `package.json`'s scripts, by name; the first 30. */
  scripts: { name: string; command: string }[];
  /** Commands that run tests, as a person types them. */
  testCommands: string[];
  /** Commands that lint, typecheck, build or check. */
  checkCommands: string[];
  /** CI configuration files, project-relative. */
  ciFiles: string[];
  baseBranch: string | null;
  /** `gh` is installed and signed in; nothing of the login is kept. */
  ghUsable: boolean;
  /** `AGENTS.md`, `CLAUDE.md` where they exist. */
  instructionFiles: string[];
  /** The tools' agent and skill folders that exist and hold something. */
  agentFolders: AgentFolder[];
  ork: OrkHolds;
  /**
   * Recent commit subjects, tags and most-changed paths; `null` when git
   * failed.
   */
  history: GitDigest | null;
};

/** What the survey asks of the machine; tests give their own. */
export type SurveyProbes = {
  /** `git <args>` in the project: its trimmed stdout, or `null` on failure. */
  git: (args: readonly string[]) => Promise<string | null>;
  ghUsable: () => Promise<boolean>;
};

/** `git` run in `root`. */
export const gitProbe =
  (root: string): SurveyProbes["git"] =>
  args =>
    new Promise(resolve => {
      execFile(
        "git",
        args,
        { cwd: root, timeout: 10_000, encoding: "utf8" },
        (error, stdout) => {
          resolve(error === null ? stdout.trim() : null);
        },
      );
    });

/**
 * Ready when `ork doctor`'s own `gh` check says logged in; its detail is never
 * read.
 */
const ghIsUsable = async (): Promise<boolean> =>
  (await gh.doctor?.(exec, process.env))?.status === "ok";

const LOCKFILES: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["Cargo.toml", "cargo"],
  ["go.mod", "go"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["Gemfile.lock", "bundler"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
];

const RUNNERS = new Set(["pnpm", "yarn", "bun", "npm"]);
const TEST_SCRIPT = /^(test|tests|e2e|spec)(:|$)/u;
const CHECK_SCRIPT =
  /^(check|lint|typecheck|type-check|tsc|build|verify|ci|validate|format)(:|$)/u;
// `(?!=)`: `lint := x` assigns a variable, it is no target.
const MAKE_TARGET = /^(test|tests|check|lint|ci|verify)\s*:(?!=)/gmu;

type PackageJson = { scripts: Record<string, unknown>; manager?: string };

/** `package.json`'s scripts and `packageManager`; empty when unreadable. */
const readPackage = (root: string): PackageJson => {
  const none = { scripts: {} };
  const text = readText(root, "package.json");
  if (text === null) return none;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null) return none;
    const scripts: unknown = Reflect.get(data, "scripts");
    const manager: unknown = Reflect.get(data, "packageManager");
    return {
      scripts:
        typeof scripts === "object" && scripts !== null
          ? Object.fromEntries(Object.entries(scripts))
          : {},
      ...(typeof manager === "string"
        ? { manager: oneLine(manager.split("@")[0] ?? "", 60) }
        : {}),
    };
  } catch {
    return none;
  }
};

const USUAL_BRANCHES = ["main", "master", "trunk", "develop"];

/** Origin's default branch, else a usual name that exists, else the current one. */
const baseBranchOf = async (
  git: SurveyProbes["git"],
): Promise<string | null> => {
  const remote = await git([
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remote?.startsWith("origin/") === true) {
    return oneLine(remote.slice("origin/".length), 80);
  }
  const found = await Promise.all(
    USUAL_BRANCHES.map(name =>
      git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]),
    ),
  );
  const usual = USUAL_BRANCHES.find((_, at) => found[at] !== null);
  if (usual !== undefined) return usual;
  const current = await git(["branch", "--show-current"]);
  return current === null || current === "" ? null : oneLine(current, 80);
};

/** Reads the repository at `root`; no model, no network, no write. */
export const readSurvey = async (
  root: string,
  probes?: SurveyProbes,
): Promise<Survey> => {
  const { git, ghUsable } = probes ?? {
    git: gitProbe(root),
    ghUsable: ghIsUsable,
  };
  const pkg = readPackage(root);
  const managers = new Set<string>(
    pkg.manager === undefined || pkg.manager === "" ? [] : [pkg.manager],
  );
  for (const [file, name] of LOCKFILES) {
    if (insideRoot(root, file) !== null) managers.add(name);
  }
  const runner = [...managers].find(m => RUNNERS.has(m)) ?? "npm";
  const scripts = Object.entries(pkg.scripts).flatMap(([name, command]) =>
    typeof command === "string"
      ? [{ name: oneLine(name, 60), command: oneLine(command, 100) }]
      : [],
  );
  const run = (name: string): string => `${runner} run ${name}`;
  const make = [
    ...(readText(root, "Makefile")?.matchAll(MAKE_TARGET) ?? []),
  ].map(m => `make ${(m[1] ?? "").trim()}`);
  const tests = [
    ...scripts.filter(s => TEST_SCRIPT.test(s.name)).map(s => run(s.name)),
    ...make.filter(c => c.includes("test")),
    ...(managers.has("cargo") ? ["cargo test"] : []),
    ...(managers.has("go") ? ["go test ./..."] : []),
  ];
  const checks = [
    ...scripts.filter(s => CHECK_SCRIPT.test(s.name)).map(s => run(s.name)),
    ...make.filter(c => !c.includes("test")),
  ];
  const [baseBranch, usable, history] = await Promise.all([
    baseBranchOf(git),
    ghUsable(),
    readGitDigest(git),
  ]);
  return {
    packageManagers: [...managers],
    scripts: scripts.slice(0, MAX_SCRIPTS),
    testCommands: capped([...new Set(tests)], MAX_NAMES).shown,
    checkCommands: capped([...new Set(checks)], MAX_NAMES).shown,
    ciFiles: ciFilesOf(root),
    baseBranch,
    ghUsable: usable,
    instructionFiles: ["AGENTS.md", "CLAUDE.md"].filter(
      file => insideRoot(root, file) !== null,
    ),
    agentFolders: agentFoldersOf(root),
    ork: orkOf(root),
    history,
  };
};

const list = (items: readonly string[]): string =>
  items.length === 0 ? "none" : items.join(", ");

/** The survey as one text input, cut at 6000 characters. */
export const surveyText = (survey: Survey): string => {
  const { ork } = survey;
  const lines = [
    `Package managers: ${list(survey.packageManagers)}`,
    `Scripts: ${list(survey.scripts.map(s => `${s.name} = ${s.command}`))}`,
    `Test commands: ${list(survey.testCommands)}`,
    `Check commands: ${list(survey.checkCommands)}`,
    `CI files: ${list(survey.ciFiles)}`,
    `Base branch: ${survey.baseBranch ?? "unknown"}`,
    `GitHub CLI: ${survey.ghUsable ? "usable" : "not usable"}`,
    `Instruction files: ${list(survey.instructionFiles)}`,
    ...survey.agentFolders.map(
      f =>
        `${f.folder}: ${list(f.entries)}${f.more === 0 ? "" : ` and ${String(f.more)} more`}`,
    ),
    ork.exists
      ? `.ork/: project.yaml ${ork.projectFile ? "yes" : "no"}; workflows ${list(ork.workflows)}; agents ${list(ork.agents)}; skills ${list(ork.skills)}`
      : ".ork/: not there",
    // Last, so the cut below takes the digest before the .ork/ line.
    digestLine(survey.history),
  ];
  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
};
