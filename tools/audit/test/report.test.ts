/**
 * @file Tests the audit's report writer and its command line on fixture runs:
 *   the report states what a partial or incomplete run is and writes only under
 *   the audit home, and the CLI fails on a bad profile before doing anything.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runFinalize } from "../finalize.ts";
import { runConsolidate } from "../findings.ts";
import { runReport } from "../report.ts";
import { runFindings } from "../verdicts.ts";
import {
  auditEnv,
  candidate,
  cleanUp,
  confirmed,
  fixtureAudits,
  gitRepo,
  mediumRecord,
  startedRun,
} from "./kit.ts";

afterEach(cleanUp);

describe("the report", () => {
  it("states a quick run is partial and writes the three files under the audit home", () => {
    const { repo, env, dir } = startedRun("quick");
    runConsolidate(repo, env, { hunts: [] });
    runFindings(repo, env, {
      records: [mediumRecord("fp-m"), confirmed("fp-l")],
      results: [],
      unique: [],
    });
    runFinalize(repo, env, { rechecks: [] });
    const { files } = runReport(repo, env, {
      posture: "Mostly sound.",
      hardening: ["Pin the thing."],
      scanner: [
        { severity: "high", title: "an action by tag", fingerprint: "s" },
      ],
    });
    const text = (name: string): string =>
      readFileSync(path.join(dir, name), "utf8");
    expect(files).toHaveLength(3);
    expect(files.every(file => file.startsWith(fixtureAudits(env)))).toBe(true);
    expect(existsSync(path.join(repo, "REPORT.md"))).toBe(false);
    expect(text("REPORT.md")).toContain("This is a partial pass");
    expect(text("REPORT.md")).toContain("Mostly sound.");
    expect(text("REPORT.md")).toContain("an action by tag");
    expect(text("FINDINGS-DETAIL.md")).toContain("Confirmed fp-m");
    expect(text("FINDINGS-DETAIL.md")).not.toContain("Confirmed fp-l");
  });

  it("lists unreviewed candidates and says the run is incomplete", () => {
    const { repo, env, dir } = startedRun("quick");
    runConsolidate(repo, env, {
      hunts: [
        {
          candidates: Array.from({ length: 13 }, (_, index) =>
            candidate(`fp-${index}`),
          ),
        },
      ],
    });
    runFindings(repo, env, { records: [] });
    runReport(repo, env, {});
    const report = readFileSync(path.join(dir, "REPORT.md"), "utf8");
    expect(report).toContain("Candidate validation is incomplete");
    expect(report).toContain("`fp-12`");
    expect(
      readFileSync(path.join(dir, "NEEDS-VALIDATION.md"), "utf8"),
    ).toContain("Not looked at");
  });
});

const cli = (command: string, env: Record<string, string>, repo: string) =>
  spawnSync(
    process.execPath,
    [path.resolve(import.meta.dirname, "../cli.ts"), command],
    { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } },
  );

describe("the command line", () => {
  it("fails scan on a bad profile with the allowed values, before anything is written", () => {
    const repo = gitRepo({ "a.txt": "x" });
    const env = auditEnv({ PROFILE: "fast" });
    const result = cli("scan", env, repo);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Allowed values: quick, standard");
    expect(existsSync(fixtureAudits(env))).toBe(false);
  });

  it("discards only the run's folder", () => {
    const { repo, env, dir } = startedRun("quick");
    const result = cli("discard", env, repo);
    expect(result.status).toBe(0);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(fixtureAudits(env))).toBe(true);
  });
});
