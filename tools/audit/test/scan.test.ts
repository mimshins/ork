/**
 * @file Tests the scanners and the previous-audit reader: `pnpm audit`
 *   advisories parsed from output with a non-zero exit (and an offline run as a
 *   note), a secret hit reported without its value, the previous audit read
 *   tolerantly, and `scan` refusing a bad input before it runs anything.
 */

import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parsePnpmAudit, runScan, scanSecrets } from "../scan.ts";
import { previousAudit } from "../store.ts";
import {
  auditEnv,
  cleanUp,
  fakeGithubToken,
  fixtureAudits,
  gitRepo,
} from "./kit.ts";

afterEach(cleanUp);

const ADVISORIES = JSON.stringify({
  advisories: {
    "1": {
      id: 1,
      module_name: "left-pad",
      title: "Prototype pollution",
      severity: "high",
      vulnerable_versions: "<1.3.0",
      patched_versions: ">=1.3.0",
      url: "https://example.com/advisory/1",
    },
  },
});

describe("parsePnpmAudit", () => {
  it("reads advisories from the output of a run that exited 1", () => {
    const { records, notes } = parsePnpmAudit({
      status: 1,
      stdout: ADVISORIES,
      stderr: "",
    });
    expect(notes).toEqual([]);
    expect(records).toMatchObject([
      {
        source: "scanner",
        check: "pnpm-audit",
        severity: "high",
        title: "left-pad: Prototype pollution",
        fingerprint: "scanner:pnpm-audit:left-pad:1",
      },
    ]);
  });

  it("finds nothing in a clean report", () => {
    expect(
      parsePnpmAudit({ status: 0, stdout: '{"advisories":{}}', stderr: "" }),
    ).toEqual({ records: [], notes: [] });
  });

  it("notes, not crashes, when pnpm audit could not run", () => {
    const { records, notes } = parsePnpmAudit({
      status: 1,
      stdout: "",
      stderr: "ERR_PNPM_AUDIT_BAD_RESPONSE: getaddrinfo ENOTFOUND",
    });
    expect(records).toEqual([]);
    expect(notes[0]).toMatch(
      /pnpm audit could not run: ERR_PNPM_AUDIT_BAD_RESPONSE/u,
    );
  });
});

describe("scanSecrets", () => {
  it("reports file, line and pattern name, never the value", () => {
    const token = fakeGithubToken();
    const records = scanSecrets([
      { path: "src/a.ts", text: `const a = 1;\nconst t = "${token}";\n` },
      { path: "src/b.ts", text: "nothing here\n" },
    ]);
    expect(records).toMatchObject([
      {
        check: "secret-pattern",
        file: "src/a.ts",
        line: 2,
        pattern: "github-token",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(token);
  });

  it("leaves out a test's placeholders, and a key block's header with no key", () => {
    const fixtures = [
      '"token ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      '"key sk-ant-api03-abcdefghijklmnopqrstuvwxyz"',
      '"aws AKIAABCDEFGHIJKLMNOP"',
      `["a private key", "-----BEGIN OPENSSH PRIVATE KEY-----"],`,
    ];
    const records = scanSecrets([
      { path: "test/a.test.ts", text: fixtures.join("\n") },
    ]);
    expect(records).toEqual([]);
  });

  it("still reports a key block that starts its line", () => {
    const records = scanSecrets([
      { path: "id_ed25519", text: "-----BEGIN OPENSSH PRIVATE KEY-----\n" },
    ]);
    expect(records.map(record => record.pattern)).toEqual([
      "private-key-block",
    ]);
  });
});

// The folder's time decides which audit is the newest.
const write = (
  dir: string,
  name: string,
  data: unknown,
  time: number,
): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), JSON.stringify(data));
  utimesSync(dir, time, time);
};

const neverRuns = (): never => {
  throw new Error("pnpm audit ran");
};

describe("previousAudit", () => {
  it("reads the newest earlier folder, not the current run's", () => {
    const repo = gitRepo({ "a.txt": "x" });
    const env = auditEnv();
    const base = fixtureAudits(env);
    write(
      path.join(base, "old"),
      "coverage-ledger.json",
      [{ coverage_id: "old", status: "covered" }],
      1,
    );
    write(
      path.join(base, "new"),
      "findings.json",
      [{ fingerprint: "f1", verdict: "confirmed", title: "T" }],
      2,
    );
    write(path.join(base, "run-1"), "findings.json", [], 3);
    const previous = previousAudit(repo, "run-1", env);
    expect(previous?.dir).toBe(path.join(base, "new"));
    expect(previous?.findings).toEqual([
      { fingerprint: "f1", status: "confirmed", title: "T" },
    ]);
    expect(previous?.ledger).toEqual([]);
  });

  it("is null when there is no earlier audit", () => {
    expect(
      previousAudit(gitRepo({ "a.txt": "x" }), "run-1", auditEnv()),
    ).toBeNull();
  });
});

describe("runScan", () => {
  const offline = { status: 1, stdout: "", stderr: "offline" };

  it("refuses a bad profile before it runs pnpm audit or makes a folder", () => {
    const repo = gitRepo({ "a.txt": "x" });
    const env = auditEnv({ PROFILE: "fast" });
    expect(() => runScan({ cwd: repo, env, audit: neverRuns })).toThrow(
      /quick, standard/u,
    );
    expect(existsSync(fixtureAudits(env))).toBe(false);
  });

  it("joins the scanners' findings and notes", () => {
    const repo = gitRepo({
      "src/a.ts": `export const t = "${fakeGithubToken()}";\n`,
      ".github/workflows/t.yml":
        "on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@v4\n",
    });
    const env = auditEnv({ PROFILE: "", SCOPE: "" });
    const result = runScan({ cwd: repo, env, audit: () => offline });
    expect(result.findings.map(item => item.check).toSorted()).toEqual([
      "missing-permissions",
      "secret-pattern",
      "unpinned-action",
    ]);
    expect(result.notes).toHaveLength(1);
    expect(result).toMatchObject({
      profile: "quick",
      runId: "run-1",
      previous: null,
    });
  });
});
