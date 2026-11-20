/**
 * @file Tests for `pnpm test`'s retry choice: `timedOutFiles` lists the files
 *   that failed only by timeouts and nothing when any failure is another kind,
 *   and `main` retries those files once alone, or never retries.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main, timedOutFiles, type TestReport } from "../run-tests.ts";

const TEST_TIMEOUT =
  "Error: Test timed out in 15000ms.\nIf this is long-running";
const HOOK_TIMEOUT =
  "Error: Hook timed out in 10000ms.\nIf this is long-running";

const failing = (...messages: string[]) => ({
  status: "failed",
  failureMessages: messages,
});
const passing = { status: "passed", failureMessages: [] };

const file = (
  name: string,
  status: string,
  assertionResults: TestReport["testResults"][number]["assertionResults"],
): TestReport["testResults"][number] => ({ name, status, assertionResults });

describe("timedOutFiles", () => {
  it("lists a file whose failures are all test or hook timeouts", () => {
    const report: TestReport = {
      testResults: [
        file("/r/a.test.ts", "failed", [failing(TEST_TIMEOUT), passing]),
        file("/r/b.test.ts", "failed", [
          failing(HOOK_TIMEOUT),
          failing(TEST_TIMEOUT),
        ]),
        file("/r/c.test.ts", "passed", [passing]),
      ],
    };
    expect(timedOutFiles(report)).toEqual(["/r/a.test.ts", "/r/b.test.ts"]);
  });

  it("lists nothing when more tests failed than timeouts were counted", () => {
    const report: TestReport = {
      numFailedTests: 2,
      testResults: [file("/r/a.test.ts", "failed", [failing(TEST_TIMEOUT)])],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });

  it("lists nothing for a passed report", () => {
    const report: TestReport = {
      testResults: [file("/r/a.test.ts", "passed", [passing])],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });

  it("lists nothing when a failure is not a timeout", () => {
    const report: TestReport = {
      testResults: [
        file("/r/a.test.ts", "failed", [failing("AssertionError: nope")]),
      ],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });

  it("lists nothing when a test has a timeout and another error", () => {
    const report: TestReport = {
      testResults: [
        file("/r/a.test.ts", "failed", [
          failing(TEST_TIMEOUT, "AssertionError: nope"),
        ]),
      ],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });

  it("lists nothing for a suite-level error", () => {
    const report: TestReport = {
      testResults: [file("/r/a.test.ts", "failed", [])],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });

  it("lists nothing when a timed-out file comes with another file's real failure", () => {
    const report: TestReport = {
      testResults: [
        file("/r/a.test.ts", "failed", [failing(TEST_TIMEOUT)]),
        file("/r/b.test.ts", "failed", [failing("Error: boom")]),
      ],
    };
    expect(timedOutFiles(report)).toEqual([]);
  });
});

const ROOT = path.resolve(import.meta.dirname, "../../..");
const OUTPUT = "--outputFile.json=";

/**
 * A fake runner: records each call's arguments, answers with `codes` in turn (1
 * past the end) and has the first call write its report with `report`.
 */
const fakeRun = (codes: number[], report?: (file: string) => void) => {
  const calls: string[][] = [];
  const run = (args: string[]): number => {
    calls.push(args);
    const out = args.find(a => a.startsWith(OUTPUT));
    if (calls.length === 1 && out !== undefined && report !== undefined) {
      report(out.slice(OUTPUT.length));
    }
    return codes[calls.length - 1] ?? 1;
  };
  return { calls, run };
};

const writeText = (text: string) => (target: string) => {
  writeFileSync(target, text);
};
const writeReport = (report: unknown) => writeText(JSON.stringify(report));
const timeouts = writeReport({
  testResults: [
    file(path.join(ROOT, "pkg/a/test/a.test.ts"), "failed", [
      failing(TEST_TIMEOUT),
    ]),
    file(path.join(ROOT, "pkg/b/test/b.test.ts"), "failed", [
      failing(HOOK_TIMEOUT),
    ]),
  ],
} satisfies TestReport);

describe("main", () => {
  const written: string[] = [];
  beforeEach(() => {
    written.length = 0;
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      written.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries the timed-out files once alone and returns the retry's code", () => {
    const { calls, run } = fakeRun([1, 0], timeouts);
    expect(main([], run)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      "run",
      "--reporter=default",
      "--reporter=json",
      expect.stringContaining(OUTPUT),
    ]);
    expect(calls[1]).toEqual([
      "run",
      "--maxWorkers=1",
      "pkg/a/test/a.test.ts",
      "pkg/b/test/b.test.ts",
    ]);
    expect(written.join("")).toContain(
      "passed only when run alone after timing out under load",
    );
  });

  it("returns a failing retry's code and says it failed again", () => {
    const { calls, run } = fakeRun([1, 3], timeouts);
    expect(main([], run)).toBe(3);
    expect(calls).toHaveLength(2);
    expect(written.join("")).toContain(
      "failed again when run alone after timing out",
    );
  });

  it("runs vitest once with the arguments and never retries", () => {
    const { calls, run } = fakeRun([1], timeouts);
    expect(main(["packages/core"], run)).toBe(1);
    expect(calls).toEqual([["run", "packages/core"]]);
  });

  it("never retries a passing first run", () => {
    const { calls, run } = fakeRun([0], timeouts);
    expect(main([], run)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["missing", undefined],
    ["not JSON", writeText("not json")],
    ["not a report", writeReport({ numTotalTests: 1 })],
    [
      "a failure that is not a timeout",
      writeReport({
        testResults: [
          file("/r/a.test.ts", "failed", [failing("AssertionError: nope")]),
        ],
      } satisfies TestReport),
    ],
  ])(
    "returns the first run's code without a retry when the report is %s",
    (_, report) => {
      const { calls, run } = fakeRun([2], report);
      expect(main([], run)).toBe(2);
      expect(calls).toHaveLength(1);
      expect(written).toEqual([]);
    },
  );
});
