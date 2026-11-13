/**
 * @file Fixtures for the audit tools' tests: a throwaway git repo and audit
 *   home under the temp folder, fake secrets built at run time (so no source
 *   line looks like a credential), recon units, candidates and finding records
 *   in the skill's shapes, and a runner for the skill's own validator scripts.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type ReconUnit, runLedger } from "../ledger.ts";

const made: string[] = [];

/** Removes every folder `tempDir` made; call from `afterEach`. */
export const cleanUp = (): void => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
};

export const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-audit-test-"));
  made.push(dir);
  return dir;
};

/** A git repo named `ork-fixture` with `files` committed. */
export const gitRepo = (files: Record<string, string>): string => {
  const repo = path.join(tempDir(), "ork-fixture");
  mkdirSync(repo);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), text);
  }
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  };
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-q",
    "-m",
    "x",
  );
  return repo;
};

/** An environment for the tools: an audit home of its own and a run id. */
export const auditEnv = (
  extra: Record<string, string> = {},
): Record<string, string> => ({
  ORK_AUDIT_HOME: path.join(tempDir(), "audits"),
  ORK_RUN: "run-1",
  ...extra,
});

/** Where the tools keep this fixture project's audits under `env`. */
export const fixtureAudits = (env: Record<string, string>): string =>
  path.join(env["ORK_AUDIT_HOME"] ?? "", "ork-fixture");

/** A fake GitHub token, assembled so this file holds no credential-shaped text. */
export const fakeGithubToken = (): string =>
  ["gh", "p_", "a1B2".repeat(10)].join("");

export const reconUnits = (count: number): ReconUnit[] =>
  Array.from({ length: count }, (_, index) => ({
    surface: `surface ${index}`,
    boundary: "local user to the daemon",
    subsystem: "packages/server",
    attack_class: "authz",
    starting_paths: [`packages/server/src/file-${index}.ts`],
    ordinary_attack_class_block: "ATTACK-CLASSES.md",
    selected_companion_blocks: [],
    excluded_blocks: [],
  }));

const trace = [
  {
    kind: "entrypoint",
    file: "src/a.ts",
    line: 3,
    scope: "handler",
    description: "reads the header",
  },
  {
    kind: "sink",
    file: "src/b.ts",
    line: 9,
    scope: "run",
    description: "runs it",
  },
];
const evidence = [{ file: "src/b.ts", line: 9, description: "the sink" }];

export const candidate = (fingerprint: string) => ({
  fingerprint,
  title: `Candidate ${fingerprint}`,
  description: "A header reaches a command.",
  claimed_root_cause: "No validation of the header.",
  trace,
  evidence,
});

export const confirmed = (fingerprint: string) => ({
  verdict: "confirmed",
  fingerprint,
  title: `Confirmed ${fingerprint}`,
  description: "A header reaches a command.",
  root_cause: "No validation of the header.",
  intended_behavior: "The header is checked first.",
  trace,
  evidence,
  conditions: [],
  execution: {
    attacker_perspective: "A local process.",
    payloads: ["x"],
    instructions: ["Send the header."],
    observed_result: "The command ran, read from the code path.",
  },
  remediation: { strategy: "Validate the header." },
  severity: {
    likelihood: { score: "low", reason: "Needs a local process." },
    impact: { score: "low", reason: "One command." },
    overall_severity: "low",
  },
  confidence: { score: "high", reason: "Traced end to end." },
});

/**
 * Where the skill's validators are: the copy in this repo, or
 * `AUDIT_SKILL_DIR`.
 */
export const skillDir = (): string =>
  process.env["AUDIT_SKILL_DIR"] ??
  path.resolve(import.meta.dirname, "../../../.ai/skills/security-audit");

export const skillPresent = (): boolean =>
  existsSync(path.join(skillDir(), "validate-findings.cjs"));

/** Runs a skill validator on `file` from a folder outside the repo. */
export const validate = (
  script: "validate-coverage-ledger.cjs" | "validate-findings.cjs",
  file: string,
): { ok: boolean; output: string } => {
  const run = spawnSync("node", [path.join(skillDir(), script), file], {
    cwd: tmpdir(),
    encoding: "utf8",
  });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
};

/** A repo with an audit started: its run's ledger written. */
export const startedRun = (profile: "quick" | "standard") => {
  const repo = gitRepo({ "a.txt": "x" });
  const env = auditEnv({ PROFILE: profile });
  const { outputDir } = runLedger(repo, env, { units: reconUnits(3) });
  return { repo, env, dir: outputDir };
};

/** A JSON file in the run's folder. */
export const readJson = (dir: string, name: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, name), "utf8"));

/** A confirmed record of medium severity. */
export const mediumRecord = (fingerprint: string) => ({
  ...confirmed(fingerprint),
  severity: {
    likelihood: { score: "medium", reason: "Needs a local process." },
    impact: { score: "medium", reason: "One user's data." },
    overall_severity: "medium",
  },
});
