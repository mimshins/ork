/**
 * @file Tests the scanners and the previous-audit reader: `pnpm audit` and `npm
 *   audit` advisories parsed from output with a non-zero exit (and an offline
 *   run as a note), the scanner chosen by lockfile, a secret hit reported
 *   without its value, the previous audit read tolerantly, `scan` refusing a
 *   bad input before it runs anything, and its notes in an attached project's
 *   run copy (the audited commit, uncommitted changes) reaching the report.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { chooseScanner, parseNpmAudit, parsePnpmAudit } from "../advisories.ts";
import { runReport } from "../report.ts";
import { realAudit, runScan, scanSecrets } from "../scan.ts";
import { previousAudit } from "../store.ts";
import {
  auditEnv,
  cleanUp,
  fakeGithubToken,
  fixtureAudits,
  gitRepo,
  tempDir,
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

const NPM_ADVISORIES = JSON.stringify({
  vulnerabilities: {
    "left-pad": {
      name: "left-pad",
      via: [
        {
          source: 1234,
          name: "left-pad",
          title: "Prototype pollution",
          url: "https://example.com/advisory/1234",
          severity: "high",
          range: "<1.3.0",
        },
      ],
    },
    app: { name: "app", via: ["left-pad"] },
    other: {
      name: "other",
      via: [
        {
          source: 1234,
          name: "left-pad",
          title: "Prototype pollution",
          severity: "high",
          range: "<1.3.0",
        },
      ],
    },
  },
});

describe("parseNpmAudit", () => {
  it("reads advisories once, and skips a package that is only named as a path", () => {
    const { records, notes } = parseNpmAudit({
      status: 1,
      stdout: NPM_ADVISORIES,
      stderr: "",
    });
    expect(notes).toEqual([]);
    expect(records).toMatchObject([
      {
        source: "scanner",
        check: "npm-audit",
        severity: "high",
        title: "left-pad: Prototype pollution",
        fingerprint: "scanner:npm-audit:left-pad:1234",
      },
    ]);
  });

  it("finds nothing in a clean report", () => {
    expect(
      parseNpmAudit({
        status: 0,
        stdout: '{"vulnerabilities":{}}',
        stderr: "",
      }),
    ).toEqual({ records: [], notes: [] });
  });

  it("notes, not crashes, on npm's error document or no output", () => {
    const offline = parseNpmAudit({
      status: 1,
      stdout: '{"error":{"code":"ENOTFOUND","summary":"request failed"}}',
      stderr: "",
    });
    expect(offline.records).toEqual([]);
    expect(offline.notes[0]).toMatch(
      /npm audit could not run: request failed/u,
    );
    const none = parseNpmAudit({ status: 1, stdout: "", stderr: "boom" });
    expect(none.notes[0]).toMatch(/npm audit could not run: boom/u);
  });
});

describe("chooseScanner", () => {
  it.each([
    [{ "pnpm-lock.yaml": "x" }, "pnpm"],
    [{ "package-lock.json": "{}" }, "npm"],
    [{ "pnpm-lock.yaml": "x", "package-lock.json": "{}" }, "pnpm"],
    [{ "yarn.lock": "x" }, null],
  ])("by lockfile %j", (files, expected) => {
    expect(chooseScanner(gitRepo({ "a.txt": "x", ...files }))).toBe(expected);
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

  it("reports an sk-ant key once, and still reports sk- and sk-proj- keys as OpenAI's", () => {
    // Built at run time so no source line looks like a credential.
    const body = "a1B2".repeat(12);
    const lines = [
      `k = "${["sk", "ant", "api03", body].join("-")}"`,
      `k = "${["sk", body].join("-")}"`,
      `k = "${["sk", "proj", body].join("-")}"`,
    ];
    const records = scanSecrets([{ path: "src/a.ts", text: lines.join("\n") }]);
    expect(records.map(record => [record.line, record.pattern])).toEqual([
      [1, "anthropic-api-key"],
      [2, "openai-api-key"],
      [3, "openai-api-key"],
    ]);
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

  it("runs the scanner its lockfile names, and notes when there is no lockfile", () => {
    const called: string[] = [];
    const audit = (_cwd: string, tool: string): typeof offline => {
      called.push(tool);
      return offline;
    };
    const run = (files: Record<string, string>): string[] =>
      runScan({ cwd: gitRepo(files), env: auditEnv(), audit }).notes;
    expect(run({ "package-lock.json": "{}" })[0]).toMatch(
      /^npm audit could not run/u,
    );
    expect(run({ "pnpm-lock.yaml": "x" })[0]).toMatch(
      /^pnpm audit could not run/u,
    );
    expect(called).toEqual(["npm", "pnpm"]);
    expect(run({ "a.txt": "x" })[0]).toMatch(/advisories were not checked/u);
    expect(called).toHaveLength(2);
  });

  it("joins the scanners' findings and notes", () => {
    const repo = gitRepo({
      "pnpm-lock.yaml": "x",
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

describe("realAudit", () => {
  it("runs the tool with `audit --json`", () => {
    const result = realAudit(process.cwd(), "echo");
    expect(result).toEqual({ status: 0, stdout: "audit --json\n", stderr: "" });
  });
});

/**
 * A per-run worktree of `repo`'s HEAD, as `ork run` makes for an attached
 * project.
 */
const runWorktree = (repo: string): string => {
  const copy = path.join(tempDir(), "run-copy");
  execFileSync("git", ["worktree", "add", "-q", "--detach", copy, "HEAD"], {
    cwd: repo,
    stdio: "ignore",
  });
  return copy;
};

const headOf = (repo: string): string =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

const DIRTY_NOTE = "uncommitted changes in your checkout are not audited";

describe("runScan in an attached project's run copy", () => {
  const offline = { status: 1, stdout: "", stderr: "offline" };
  const scanCopy = (
    files: Record<string, string>,
    dirty: boolean,
  ): { repo: string; copy: string; result: ReturnType<typeof runScan> } => {
    const repo = gitRepo(files);
    const copy = runWorktree(repo);
    if (dirty) writeFileSync(path.join(repo, "a.txt"), "changed");
    const env = auditEnv({ ORK_SOURCE_ROOT: repo });
    return {
      repo,
      copy,
      result: runScan({ cwd: copy, env, audit: () => offline }),
    };
  };

  it("names the audited commit and nothing else when the checkout is clean", () => {
    const { repo, result } = scanCopy({ "a.txt": "x" }, false);
    expect(result.notes).toEqual([
      `audited commit ${headOf(repo)} (a per-run copy of HEAD)`,
      expect.stringMatching(/advisories were not checked/u),
    ]);
  });

  it("also says uncommitted changes in the checkout are not audited", () => {
    const { repo, result } = scanCopy({ "a.txt": "x" }, true);
    expect(result.notes.slice(0, 2)).toEqual([
      `audited commit ${headOf(repo)} (a per-run copy of HEAD)`,
      DIRTY_NOTE,
    ]);
  });

  it("keeps the report in the source project's folder and carries both notes", () => {
    const { copy, result } = scanCopy({ "a.txt": "x" }, true);
    expect(result.outputDir).toBe(
      path.join(path.dirname(result.outputDir), "run-1"),
    );
    expect(path.basename(path.dirname(result.outputDir))).toBe("ork-fixture");
    const env = auditEnv({
      ORK_AUDIT_HOME: path.dirname(path.dirname(result.outputDir)),
    });
    runReport(copy, env, { notes: result.notes });
    const report = readFileSync(
      path.join(result.outputDir, "REPORT.md"),
      "utf8",
    );
    expect(report).toContain("- Note: audited commit ");
    expect(report).toContain(`- Note: ${DIRTY_NOTE}`);
  });

  it("adds no such note without ORK_SOURCE_ROOT", () => {
    const repo = gitRepo({ "a.txt": "x" });
    writeFileSync(path.join(repo, "a.txt"), "changed");
    const { notes } = runScan({
      cwd: repo,
      env: auditEnv(),
      audit: () => offline,
    });
    expect(notes).toEqual([
      expect.stringMatching(/advisories were not checked/u),
    ]);
  });
});
