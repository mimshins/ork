/**
 * @file The audit's `finalize` step: the skill's Phase 5 outcome applied to
 *   `findings.json`. Under `standard`, every `confirmed` record needs a
 *   `verified` answer from the `recheck` node. A record whose recheck asked to
 *   `replace` it, or never came back, is removed and kept in `disputed.json`:
 *   the skill allows a replacement that changes a record only after another
 *   fresh verifier checks it, and the workflow runs none, so the disputed
 *   record is an unresolved candidate, never a finding. Under `quick` the first
 *   verifier already covered Phase 5, so nothing is rechecked. The run is
 *   marked `complete` only when nothing is unreviewed, unverified or disputed.
 */

import path from "node:path";

import { checkInputs } from "./inputs.ts";
import { isObject, str, writeJson } from "./json.ts";
import { outputDir, readRows, updateMetadata } from "./store.ts";

type Env = Record<string, string | undefined>;

export type FinalizeResult = {
  outputDir: string;
  counts: Record<string, number>;
  /** `counts` as one line, for a gate (a declared output holds no object). */
  countsText: string;
  /** What the report agent reads: no traces, only who and how bad. */
  confirmed: { fingerprint: string; title: string; severity: string }[];
  needsValidation: { fingerprint: string; title: string }[];
  disputed: { fingerprint: string; title: string; reason: string }[];
  unreviewed: number;
  unverified: number;
  /** `null` when the run is complete. */
  incompleteReason: string | null;
};

const severityOf = (record: Record<string, unknown>): string => {
  const severity = record["severity"];
  return isObject(severity) ? str(severity["overall_severity"]) : "";
};

/**
 * Applies the rechecks (`{ fingerprint, decision, reason }` each) to
 * `findings.json`.
 */
export const runFinalize = (
  cwd: string,
  env: Env,
  input: { rechecks?: readonly unknown[] | undefined },
): FinalizeResult => {
  const { profile } = checkInputs(env["PROFILE"], env["SCOPE"]);
  const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
  const rechecks = (input.rechecks ?? []).filter(item => isObject(item));
  const records = readRows(path.join(dir, "findings.json"));

  const fresh: FinalizeResult["disputed"] = [];
  const kept = records.filter(record => {
    if (profile !== "standard" || record["verdict"] !== "confirmed")
      return true;
    const answer = rechecks.find(
      item => str(item["fingerprint"]) === str(record["fingerprint"]),
    );
    if (answer?.["decision"] === "verified") return true;
    fresh.push({
      fingerprint: str(record["fingerprint"]),
      title: str(record["title"]),
      reason:
        answer === undefined
          ? "the recheck returned nothing, so no fresh verifier confirmed this record"
          : `the recheck asked to replace it, and no further verifier ran: ${str(answer["reason"])}`,
    });
    return false;
  });
  // A rerun finds those records already gone from findings.json, so the ones
  // disputed before stay: union by fingerprint, this run's reason winning.
  const earlier = readRows(path.join(dir, "disputed.json")).map(item => ({
    fingerprint: str(item["fingerprint"]),
    title: str(item["title"]),
    reason: str(item["reason"]),
  }));
  const disputed = [
    ...earlier.filter(
      item => !fresh.some(now => now.fingerprint === item.fingerprint),
    ),
    ...fresh,
  ];
  writeJson(path.join(dir, "findings.json"), kept);
  writeJson(path.join(dir, "disputed.json"), disputed);

  const unverifiedRows = readRows(path.join(dir, "unverified.json"));
  const unverified = unverifiedRows.length;
  // A past-cap candidate the validator refused is unverified, not unreviewed.
  const unreviewed = readRows(path.join(dir, "unreviewed.json")).filter(
    row =>
      !unverifiedRows.some(item => item["fingerprint"] === row["fingerprint"]),
  ).length;
  const incompleteReason =
    unreviewed > 0
      ? "validation_budget_exhausted"
      : unverified > 0
        ? "candidate_validation_incomplete"
        : disputed.length > 0
          ? "final_verification_unresolved"
          : null;
  updateMetadata(
    dir,
    incompleteReason === null
      ? { run_status: "complete" }
      : { run_status: "incomplete", incomplete_reason: incompleteReason },
  );

  const counts: Record<string, number> = {};
  for (const record of kept) {
    counts[str(record["verdict"])] = (counts[str(record["verdict"])] ?? 0) + 1;
  }
  return {
    outputDir: dir,
    counts,
    countsText:
      Object.entries(counts)
        .map(([verdict, count]) => `${verdict}: ${count}`)
        .join(", ") || "no records",
    confirmed: kept
      .filter(record => record["verdict"] === "confirmed")
      .map(record => ({
        fingerprint: str(record["fingerprint"]),
        title: str(record["title"]),
        severity: severityOf(record),
      })),
    needsValidation: kept
      .filter(record => record["verdict"] === "needs_validation")
      .map(record => ({
        fingerprint: str(record["fingerprint"]),
        title: str(record["title"]),
      })),
    disputed,
    unreviewed,
    unverified,
    incompleteReason,
  };
};
