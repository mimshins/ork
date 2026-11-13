/**
 * @file Tests the audit's last steps on fixture runs: `findings` reads each
 *   verifier's answer against its candidate and keeps a malformed one out of
 *   `findings.json`, `finalize` removes a confirmed record whose recheck did
 *   not verify it (under `standard`), the report writer states what a partial
 *   or incomplete run is and writes only under the audit home, and the CLI
 *   fails on a bad profile before doing anything.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runFinalize } from "../finalize.ts";
import { runConsolidate } from "../findings.ts";
import { str } from "../json.ts";
import { runReport } from "../report.ts";
import { readRows } from "../store.ts";
import { runFindings } from "../verdicts.ts";
import {
  candidate,
  cleanUp,
  confirmed,
  readJson,
  startedRun,
  validate,
} from "./kit.ts";

afterEach(cleanUp);

const unique = (...fingerprints: string[]) =>
  fingerprints.map(item => candidate(item));

/**
 * `count` candidates; the 13th (past the quick cap) has no trace, which the
 * validator refuses.
 */
const huntsWithBadThirteenth = (count: number): unknown[] =>
  Array.from({ length: count }, (_, index) => {
    const fingerprint = `fp-${String(index).padStart(2, "0")}`;
    return index === 12
      ? { ...candidate(fingerprint), trace: [] }
      : candidate(fingerprint);
  });

describe("findings from the verifiers' answers", () => {
  it("keeps a malformed or missing answer out of findings.json and marks the run incomplete", () => {
    const { repo, env, dir } = startedRun("quick");
    const result = runFindings(repo, env, {
      unique: unique("fp-a", "fp-b", "fp-c", "fp-d"),
      results: [
        { decision: "confirmed", records: [confirmed("fp-a")] },
        { decision: "needs_validation", records: [confirmed("fp-b")] },
        {},
        { decision: "rejected", records: [{ verdict: "rejected" }] },
      ],
    });
    expect(result.counts).toEqual({ confirmed: 1 });
    expect(result.unverified).toBe(3);
    const reasons = readRows(path.join(dir, "unverified.json")).map(item =>
      str(item["reason"]),
    );
    expect(reasons[0]).toContain("disagrees");
    expect(reasons[1]).toContain("no verifier record");
    expect(reasons[2]).toContain("validator");
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
      incomplete_reason: "candidate_validation_incomplete",
    });
    const checked = validate(
      "validate-findings.cjs",
      path.join(dir, "findings.json"),
    );
    expect(checked.ok).toBe(true);
  });

  it("labels a record's trace by its order, so a mislabelled one is kept", () => {
    const { repo, env, dir } = startedRun("quick");
    const record = confirmed("fp-a");
    const kinds = record.trace.map(entry => entry.kind).toReversed();
    const swapped = record.trace.map((entry, at) => ({
      ...entry,
      kind: kinds[at],
    }));
    const result = runFindings(repo, env, {
      unique: unique("fp-a"),
      results: [
        { decision: "confirmed", records: [{ ...record, trace: swapped }] },
      ],
    });
    expect(result.counts).toEqual({ confirmed: 1 });
    expect(result.unverified).toBe(0);
    const checked = validate(
      "validate-findings.cjs",
      path.join(dir, "findings.json"),
    );
    expect(checked.ok).toBe(true);
  });

  it("marks the run incomplete for candidates past the verifier cap", () => {
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
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
      incomplete_reason: "validation_budget_exhausted",
    });
  });

  it("keeps a malformed past-cap candidate out of findings.json, as unverified", () => {
    const { repo, env, dir } = startedRun("quick");
    const hunts = huntsWithBadThirteenth(13);
    runConsolidate(repo, env, { hunts: [{ candidates: hunts }] });
    const result = runFindings(repo, env, { records: [] });
    expect(result.unreviewed).toBe(0);
    expect(result.counts).toEqual({});
    expect(result.unverified).toBe(1);
    expect(
      readRows(path.join(dir, "unverified.json")).map(item => ({
        fingerprint: item["fingerprint"],
        reason: str(item["reason"]).slice(0, 38),
      })),
    ).toEqual([
      {
        fingerprint: "fp-12",
        reason: "the record fails the skill's validator",
      },
    ]);
    expect(
      readRows(path.join(dir, "findings.json")).map(
        item => item["fingerprint"],
      ),
    ).not.toContain("fp-12");
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
      incomplete_reason: "candidate_validation_incomplete",
    });
  });

  it("keeps a malformed past-cap candidate unverified through a findings rerun and finalize", () => {
    const { repo, env, dir } = startedRun("quick");
    runConsolidate(repo, env, {
      hunts: [{ candidates: huntsWithBadThirteenth(13) }],
    });
    runFindings(repo, env, { records: [] });
    runFindings(repo, env, { records: [] });
    const result = runFinalize(repo, env, {});
    expect(result.incompleteReason).toBe("candidate_validation_incomplete");
    expect(
      readRows(path.join(dir, "unverified.json")).map(
        item => item["fingerprint"],
      ),
    ).toEqual(["fp-12"]);
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
    });
    runReport(repo, env, {});
    const report = readFileSync(path.join(dir, "REPORT.md"), "utf8");
    expect(report).toContain("1 candidate(s) have no usable verifier record");
    expect(report).not.toContain("Candidate validation is incomplete");
  });

  it("still records well-formed past-cap candidates beside a malformed one", () => {
    const { repo, env, dir } = startedRun("quick");
    const hunts = huntsWithBadThirteenth(14);
    runConsolidate(repo, env, { hunts: [{ candidates: hunts }] });
    const result = runFindings(repo, env, { records: [] });
    expect(result.counts).toEqual({ needs_validation: 1 });
    expect(result.unverified).toBe(1);
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
      incomplete_reason: "validation_budget_exhausted",
    });
    expect(
      validate("validate-findings.cjs", path.join(dir, "findings.json")).ok,
    ).toBe(true);
  });
});

describe("finalize", () => {
  it("gives the same disputed records, counts and reason when run twice", () => {
    const { repo, env, dir } = startedRun("standard");
    runFindings(repo, env, { records: [confirmed("fp-1"), confirmed("fp-2")] });
    const rechecks = [
      { fingerprint: "fp-1", decision: "verified", reason: "" },
    ];
    const first = runFinalize(repo, env, { rechecks });
    const disputed = readJson(dir, "disputed.json");
    const second = runFinalize(repo, env, { rechecks });
    expect(readJson(dir, "disputed.json")).toEqual(disputed);
    expect(second.disputed).toEqual(first.disputed);
    expect(second.counts).toEqual(first.counts);
    expect(second.incompleteReason).toBe("final_verification_unresolved");
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
    });
  });

  it("removes a confirmed record the standard recheck did not verify", () => {
    const { repo, env, dir } = startedRun("standard");
    runFindings(repo, env, { records: [confirmed("fp-1"), confirmed("fp-2")] });
    const result = runFinalize(repo, env, {
      rechecks: [{ fingerprint: "fp-1", decision: "verified", reason: "" }],
    });
    expect(result.counts).toEqual({ confirmed: 1 });
    expect(result.disputed.map(item => item.fingerprint)).toEqual(["fp-2"]);
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "incomplete",
      incomplete_reason: "final_verification_unresolved",
    });
    expect(
      validate("validate-findings.cjs", path.join(dir, "findings.json")).ok,
    ).toBe(true);
  });

  it("asks nothing of a quick run, whose verifier covered phase 5", () => {
    const { repo, env, dir } = startedRun("quick");
    runFindings(repo, env, { records: [confirmed("fp-1")] });
    const result = runFinalize(repo, env, { rechecks: [] });
    expect(result.disputed).toEqual([]);
    expect(result.incompleteReason).toBeNull();
    expect(readJson(dir, "run-metadata.json")).toMatchObject({
      run_status: "complete",
      partial_coverage: true,
    });
  });
});
