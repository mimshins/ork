/**
 * @file `pnpm test`: runs `vitest run`, and when the bare run fails only
 *   because test files timed out under load (a check shares the machine with
 *   other runs), runs those files once more alone (`--maxWorkers=1`) and exits
 *   with that retry's code. Any other failure, an unreadable report or a
 *   crashed run is not retried; `pnpm test <args>` never retries.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The part of vitest's JSON report this wrapper reads. */
export type TestReport = {
  numFailedTests?: number;
  testResults: {
    name: string;
    status: string;
    assertionResults: { status: string; failureMessages?: string[] }[];
  }[];
};

const TIMEOUT = /^(?:Error: )?(?:Test|Hook) timed out in \d+ms/u;

/**
 * The failed files whose every failure is a test or hook timeout. Empty when
 * any failed file has another failure or a suite-level error (a failed file
 * with no failed test), so the run is not retried.
 */
export const timedOutFiles = (report: TestReport): string[] => {
  const failed = report.testResults.filter(f => f.status === "failed");
  const failures = (f: TestReport["testResults"][number]) =>
    f.assertionResults.filter(a => a.status === "failed");
  const onlyTimeouts = failed.every(f => {
    const tests = failures(f);
    return (
      tests.length > 0 &&
      tests.every(
        a =>
          (a.failureMessages ?? []).length > 0 &&
          (a.failureMessages ?? []).every(m => TIMEOUT.test(m)),
      )
    );
  });
  // vitest keeps unhandled errors outside `testResults`; a failed-test count
  // above the timeouts seen means something else failed too.
  const counted = failed.reduce((n, f) => n + failures(f).length, 0);
  const unexplained =
    report.numFailedTests !== undefined && report.numFailedTests !== counted;
  return onlyTimeouts && !unexplained ? failed.map(f => f.name) : [];
};

const ROOT = path.resolve(import.meta.dirname, "../..");
const VITEST = path.join(ROOT, "node_modules/.bin/vitest");

/**
 * Runs vitest from the repository root with `args`; its exit code (1 when it
 * did not start).
 */
const vitest = (args: string[]): number =>
  spawnSync(VITEST, args, { cwd: ROOT, stdio: "inherit" }).status ?? 1;

// Checks the top level only; a malformed file entry throws in `timedOutFiles`,
// which `retryFiles` catches.
const isReport = (value: unknown): value is TestReport =>
  typeof value === "object" &&
  value !== null &&
  "testResults" in value &&
  Array.isArray(value.testResults);

/** The files of the report at `file` to retry; none when it cannot be read. */
const retryFiles = (file: string): string[] => {
  try {
    const report: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isReport(report) ? timedOutFiles(report) : [];
  } catch {
    return [];
  }
};

const main = (args: string[]): number => {
  if (args.length > 0) return vitest(["run", ...args]);
  const dir = mkdtempSync(path.join(tmpdir(), "ork-test-report-"));
  try {
    const file = path.join(dir, "report.json");
    const code = vitest([
      "run",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${file}`,
    ]);
    if (code === 0) return 0;
    const files = retryFiles(file);
    if (files.length === 0) return code;
    const rel = files.map(f => path.relative(ROOT, f));
    const retry = vitest(["run", "--maxWorkers=1", ...rel]);
    process.stderr.write(
      retry === 0
        ? `passed only when run alone after timing out under load: ${rel.join(", ")}\n`
        : `failed again when run alone after timing out: ${rel.join(", ")}\n`,
    );
    return retry;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
