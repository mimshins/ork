/**
 * @file Where an audit's files live: `~/.ork/audits/<project-name>/<run-id>/`,
 *   outside the checkout (the repository is public, and an audit's report,
 *   ledger and findings must never reach it). `ORK_AUDIT_HOME` replaces
 *   `~/.ork/audits` (the tests use it); `ORK_AUDIT_PROJECT` replaces the
 *   project's name. Also reads the previous audit, so runs build on each
 *   other.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** The project's name: its main checkout's folder, even from a worktree. */
export const projectName = (cwd: string, env: Env = process.env): string => {
  const set = env["ORK_AUDIT_PROJECT"];
  if (set !== undefined && set !== "") return set;
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return path.basename(path.dirname(common));
  } catch {
    return path.basename(path.resolve(cwd));
  }
};

/** `~/.ork/audits/<project-name>`: every audit of this project. */
export const projectDir = (cwd: string, env: Env = process.env): string =>
  path.join(
    env["ORK_AUDIT_HOME"] ?? path.join(homedir(), ".ork", "audits"),
    projectName(cwd, env),
  );

/** The run's output folder, created private to the user. */
export const outputDir = (
  cwd: string,
  runId: string,
  env: Env = process.env,
): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId)) {
    throw new Error("ORK_RUN is not set to a usable run id");
  }
  const dir = path.join(projectDir(cwd, env), runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

export type PreviousAudit = {
  /** The earlier audit's folder. */
  dir: string;
  ledger: { coverage_id: string; status: string }[];
  findings: { fingerprint: string; status: string; title: string }[];
};

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
    : [];

/**
 * The newest earlier audit of this project (by folder time), leaving out the
 * current run's folder and any folder with neither a ledger nor findings (a run
 * that stopped before recon finished). Missing or broken files read as empty:
 * the previous audit is context, never a reason to stop.
 */
export const previousAudit = (
  cwd: string,
  currentRun: string,
  env: Env = process.env,
): PreviousAudit | null => {
  const base = projectDir(cwd, env);
  if (!existsSync(base)) return null;
  const candidates = readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== currentRun)
    .map(entry => path.join(base, entry.name))
    .filter(
      dir =>
        existsSync(path.join(dir, "coverage-ledger.json")) ||
        existsSync(path.join(dir, "findings.json")),
    )
    .map(dir => ({ dir, time: statSync(dir).mtimeMs }))
    .toSorted((a, b) => b.time - a.time);
  const newest = candidates[0]?.dir;
  if (newest === undefined) return null;
  return {
    dir: newest,
    ledger: rows(readJson(path.join(newest, "coverage-ledger.json"))).map(
      unit => ({
        coverage_id: text(unit["coverage_id"]),
        status: text(unit["status"]),
      }),
    ),
    findings: rows(readJson(path.join(newest, "findings.json"))).map(
      finding => ({
        fingerprint: text(finding["fingerprint"]),
        status: text(finding["verdict"]),
        title: text(finding["title"]),
      }),
    ),
  };
};

/** Reads a JSON array of objects from `file`; a missing file reads as empty. */
export const readRows = (file: string): Record<string, unknown>[] => {
  const data = readJson(file);
  return rows(data);
};

/** Reads a JSON object from `file`; a missing or broken file reads as empty. */
export const readObject = (file: string): Record<string, unknown> => {
  const data = readJson(file);
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data))
    : {};
};

/**
 * Merges `patch` into the run's `run-metadata.json` (nothing when the run has
 * none yet).
 */
export const updateMetadata = (
  dir: string,
  patch: Record<string, unknown>,
): void => {
  const file = path.join(dir, "run-metadata.json");
  if (!existsSync(file)) return;
  writeFileSync(
    file,
    `${JSON.stringify({ ...readObject(file), ...patch }, null, 2)}\n`,
  );
};
