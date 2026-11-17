/**
 * @file Tests the written security-audit bundle on its own: Ork writes it into
 *   a throwaway git project that holds none of this repository's files, and
 *   every script the workflow calls (`scan`, `ledger`, `consolidate`,
 *   `findings`, `finalize`, `report`, `discard`) runs from the written folder,
 *   the skill's two validators accept what they wrote, no bundled text names
 *   this repository's own folders, and `scan` refuses a bundle outside the
 *   project.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditEnv,
  bundleCli,
  bundleProject,
  type BundleProject,
  candidate,
  cleanUp,
  confirmed,
  gitRepo,
  printed,
  reconUnits,
  validate,
} from "./kit.ts";

afterEach(cleanUp);

/** Every file under the bundle's folder: its path (relative) and text. */
const bundleTexts = (project: BundleProject): [string, string][] =>
  readdirSync(project.folder, { recursive: true, encoding: "utf8" })
    .filter(name => statSync(path.join(project.folder, name)).isFile())
    .map(name => [name, readFileSync(path.join(project.folder, name), "utf8")]);

/** Runs a command that must succeed and returns what it printed. */
const ok = (
  project: BundleProject,
  command: string,
  env: Record<string, string>,
  input?: unknown,
): Record<string, unknown> => {
  const run = bundleCli(project, command, env, input);
  expect({ command, status: run.status, stderr: run.stderr }).toEqual({
    command,
    status: 0,
    stderr: "",
  });
  return printed(run.stdout);
};

/** The audit's steps in order on a fresh project, as the workflow runs them. */
const runAudit = (profile: "quick" | "standard") => {
  const project = bundleProject();
  const env = auditEnv({ PROFILE: profile, SCOPE: "all" });
  const scan = ok(project, "scan", env);
  const ledger = ok(project, "ledger", env, { units: reconUnits(3) });
  const consolidate = ok(project, "consolidate", env, {
    hunts: [{ candidates: [candidate("fp-1"), candidate("fp-2")] }],
    gaps: [],
  });
  const findings = ok(project, "findings", env, {
    results: [
      { decision: "confirmed", records: [confirmed("fp-1")] },
      { decision: "confirmed", records: [confirmed("fp-2")] },
    ],
    unique: consolidate["unique"],
  });
  const finalize = ok(project, "finalize", env, {
    rechecks: [{ fingerprint: "fp-1", decision: "verified", reason: "" }],
  });
  const report = ok(project, "report", env, {
    posture: "Mostly sound.",
    hardening: ["Pin the thing."],
    positive: [],
    scanner: [],
    notes: [],
    previous: "none",
  });
  return {
    project,
    env,
    scan,
    ledger,
    consolidate,
    findings,
    finalize,
    report,
  };
};

const filesOf = (step: Record<string, unknown>): string[] => {
  const files = step["files"];
  return Array.isArray(files) ? files.map(String) : [];
};

const dirOf = (step: Record<string, unknown>): string =>
  String(step["outputDir"]);

describe("the written security-audit bundle", () => {
  it("runs scan, ledger, consolidate, findings, finalize and report from its folder", () => {
    const run = runAudit("standard");
    expect(run.scan["notes"]).toEqual(
      expect.arrayContaining([expect.stringContaining("not checked")]),
    );
    expect(run.scan["previousText"]).toBe("none");
    expect(run.ledger["hunt"]).toHaveLength(3);
    expect(run.consolidate["unique"]).toHaveLength(2);
    expect(run.findings["counts"]).toEqual({ confirmed: 2 });
    expect(run.finalize["counts"]).toEqual({ confirmed: 1 });
    expect(run.report["files"]).toHaveLength(3);
    for (const file of filesOf(run.report)) {
      expect(existsSync(file)).toBe(true);
      expect(file.startsWith(path.dirname(dirOf(run.report)))).toBe(true);
      expect(file.startsWith(run.project.repo)).toBe(false);
    }
  });

  it("writes a ledger and findings the bundled validators accept", () => {
    const run = runAudit("standard");
    const dir = dirOf(run.report);
    const { skill } = run.project;
    expect(
      validate(
        "validate-coverage-ledger.cjs",
        `${dir}/coverage-ledger.json`,
        skill,
      ),
    ).toMatchObject({ ok: true });
    expect(
      validate("validate-findings.cjs", `${dir}/findings.json`, skill),
    ).toMatchObject({ ok: true });
  });

  it("discards the run's folder and leaves the report's home", () => {
    const run = runAudit("quick");
    const dir = dirOf(run.report);
    ok(run.project, "discard", run.env);
    expect(existsSync(dir)).toBe(false);
  });

  it("names no folder of this repository in any bundled text", () => {
    const texts = bundleTexts(bundleProject());
    expect(texts.length).toBeGreaterThan(20);
    for (const [name, text] of texts) {
      for (const host of [".ai/skills", "tools/audit", ".ork/context"]) {
        expect({ name, host, found: text.includes(host) }).toEqual({
          name,
          host,
          found: false,
        });
      }
    }
  });

  it("makes scan fail, naming ork migrate, when the bundle is outside the project", () => {
    const project = bundleProject();
    const attached = gitRepo({ "b.txt": "y" });
    const run = bundleCli(
      project,
      "scan",
      auditEnv({ PROFILE: "quick", SCOPE: "all" }),
      {},
      attached,
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("ork migrate");
  });
});
