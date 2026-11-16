/**
 * @file Tests `check-record`, the `verify` node's check: the four schema
 *   mistakes verifiers make are each named, a record that passes the skill's
 *   validator passes, and one it refuses fails with the validator's reason.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordProblems, runCheckRecord } from "../check-record.ts";
import {
  auditEnv,
  cleanUp,
  confirmed,
  gitRepo,
  skillPresent,
  tempDir,
} from "./kit.ts";

afterEach(cleanUp);

const reportWith = (record: Record<string, unknown>) => ({
  status: "pass",
  summary: "checked",
  artifacts: {},
  decision: "confirmed",
  records: [record],
});

const good = confirmed("fp-1");

const withTrace = (scope: Record<string, unknown>) => ({
  ...good,
  trace: good.trace.map((entry, at) => (at === 0 ? scope : entry)),
});

const { scope: _dropped, ...noScope } = good.trace[0] ?? {};

describe("recordProblems", () => {
  it("finds nothing wrong with a well-formed record", () => {
    expect(recordProblems(reportWith(good))).toEqual([]);
  });

  it.each([
    [
      "a trace entry without scope",
      withTrace(noScope),
      "trace[0] has no `scope`",
    ],
    ["an extra scope_note", { ...good, scope_note: "x" }, "`scope_note`"],
    [
      "execution.instructions as a string",
      { ...good, execution: { ...good.execution, instructions: "Send it." } },
      "`execution.instructions` is a string",
    ],
    [
      "remediation.fixes",
      { ...good, remediation: { strategy: "x", fixes: ["y"] } },
      "`remediation.fixes`",
    ],
  ])("names %s", (_what, record, reason) => {
    expect(recordProblems(reportWith(record)).join("\n")).toContain(reason);
  });

  it("needs exactly one record", () => {
    expect(recordProblems({ decision: "confirmed", records: [] })).toEqual([
      "`records` must be a list with exactly one record object",
    ]);
  });
});

// The skill's validators live in `.ai/skills/security-audit/` (or
// `AUDIT_SKILL_DIR`); these wait until that folder is there.
const describeWithSkill = skillPresent() ? describe : describe.skip;

/** A check of `report` as the `verify:` step runs it, to call. */
const check = (report: unknown) => {
  const file = path.join(tempDir(), "verify.1.verify-1.report.json");
  writeFileSync(file, JSON.stringify(report));
  const env = auditEnv({
    ORK_REPORT: file,
    ORK_ITEM: JSON.stringify({ fingerprint: "fp-1" }),
  });
  return () => runCheckRecord(gitRepo({ "a.txt": "x" }), env);
};

describeWithSkill("runCheckRecord", () => {
  it("passes a record the validator accepts", () => {
    expect(check(reportWith(good))()).toEqual({
      fingerprint: "fp-1",
      verdict: "confirmed",
    });
  });

  it("fails with the named reason before the validator runs", () => {
    expect(check(reportWith({ ...good, scope_note: "x" }))).toThrow(
      "`scope_note`",
    );
  });

  it("fails with the validator's reason for any other mistake", () => {
    expect(check(reportWith({ ...good, title: "" }))).toThrow(
      "the record fails the skill's validator",
    );
  });

  it("fails when the record's verdict disagrees with the decision", () => {
    expect(
      check({ ...reportWith(good), decision: "needs_validation" }),
    ).toThrow("disagrees");
  });
});
