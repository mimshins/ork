/**
 * @file Tests for `pnpm test`'s retry choice: `timedOutFiles` lists the files
 *   that failed only by timeouts and nothing when any failure is another kind.
 */

import { describe, expect, it } from "vitest";

import { timedOutFiles, type TestReport } from "../run-tests.ts";

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
