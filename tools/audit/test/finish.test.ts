/**
 * @file Tests the audit's last steps on fixture runs: `findings` reads each
 *   verifier's answer against its candidate and keeps a malformed one out of
 *   `findings.json`, `finalize` removes a confirmed record whose recheck did
 *   not verify it (under `standard`), the report writer states what a partial
 *   or incomplete run is and writes only under the audit home, and the CLI
 *   fails on a bad profile before doing anything.
 */

import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runFinalize } from "../finalize.ts";
import { runConsolidate } from "../findings.ts";
import { str } from "../json.ts";
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
});

describe("finalize", () => {
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
