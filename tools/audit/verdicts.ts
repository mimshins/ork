/**
 * @file The audit's `findings` step: writes `findings.json` from the verifiers'
 *   answers, checking each verifier record on its own with the skill's
 *   validator, so one malformed record cannot stop a run that has already paid
 *   for the rest. A candidate with no usable record is kept apart and marks the
 *   run incomplete.
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

import { isObject, type Json, objects, str, writeJson } from "./json.ts";
import { outputDir, readRows, updateMetadata } from "./store.ts";

type Env = Record<string, string | undefined>;

export type FindingsResult = {
  outputDir: string;
  file: string;
  total: number;
  counts: Record<string, number>;
  /** Candidates whose verifier returned nothing usable (not findings). */
  unverified: number;
  /** Candidates past the verifier cap (`needs_validation`, not looked at). */
  unreviewed: number;
  /** The records `confirmed`, for the `recheck` node's `forEach`. */
  confirmed: Json[];
};

/**
 * Where the skill's validator scripts are: this repo's copy, or
 * `AUDIT_SKILL_DIR`.
 */
export const skillDir = (env: Env): string =>
  env["AUDIT_SKILL_DIR"] ??
  path.resolve(import.meta.dirname, "../../.ai/skills/security-audit");

/** What the skill's validator says about `records`, or "" when they pass. */
const validatorError = (dir: string, env: Env, records: Json[]): string => {
  const file = path.join(dir, "check-one.json");
  writeJson(file, records);
  const run = spawnSync(
    process.execPath,
    [path.join(skillDir(env), "validate-findings.cjs"), file],
    { cwd: dir, encoding: "utf8" },
  );
  rmSync(file, { force: true });
  return run.status === 0
    ? ""
    : `${run.stdout}${run.stderr}`.trim().slice(0, 400);
};

/**
 * Each candidate's verifier result (`{ decision, records: [record] }`, in the
 * order of `unique`) as a record, or as an `unverified` entry saying why not: a
 * result a verifier never returned, or that its own verdict or the skill's
 * validator refuses, is discarded, never repaired.
 */
const verifiedRecords = (
  dir: string,
  env: Env,
  unique: readonly unknown[],
  results: readonly unknown[],
): { records: Json[]; unverified: Json[] } => {
  const records: Json[] = [];
  const unverified: Json[] = [];
  for (const [index, candidate] of objects(unique).entries()) {
    const result = results[index];
    const decision = isObject(result) ? str(result["decision"]) : "";
    const list = isObject(result) ? result["records"] : undefined;
    const record = Array.isArray(list) ? objects(list)[0] : undefined;
    const final =
      record === undefined
        ? undefined
        : {
            ...record,
            verdict: record["verdict"] ?? decision,
            fingerprint:
              str(record["fingerprint"]) || str(candidate["fingerprint"]),
          };
    const error = final === undefined ? "" : validatorError(dir, env, [final]);
    const reason =
      final === undefined
        ? "no verifier record came back"
        : final.verdict === decision
          ? error && `the record fails the skill's validator: ${error}`
          : "the record's verdict disagrees with the verifier's decision";
    if (final !== undefined && reason === "") {
      records.push(final);
    } else {
      unverified.push({
        fingerprint: candidate["fingerprint"],
        title: candidate["title"],
        reason,
      });
    }
  }
  return { records, unverified };
};

/**
 * Writes `findings.json`: the verifiers' records (`records`, or `results` read
 * against `unique`) plus `unreviewed.json`, one per fingerprint (a verifier's
 * record wins), sorted by fingerprint. A candidate with no usable verifier
 * record goes to `unverified.json`, and any of those or of the unreviewed ones
 * marks `run-metadata.json` incomplete. The skill's SKILL.md says an
 * unvalidated candidate must not be relabelled `needs_validation`; the plan
 * decides otherwise for the ones past the cap, so the metadata and the report
 * say the run is incomplete and why.
 */
export const runFindings = (
  cwd: string,
  env: Env,
  input: {
    records?: readonly unknown[] | undefined;
    results?: readonly unknown[] | undefined;
    unique?: readonly unknown[] | undefined;
  },
): FindingsResult => {
  const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
  const verified = verifiedRecords(
    dir,
    env,
    input.unique ?? [],
    input.results ?? [],
  );
  const unreviewed = readRows(path.join(dir, "unreviewed.json"));
  const byFingerprint = new Map<string, Json>();
  for (const record of [
    ...objects(input.records ?? []),
    ...verified.records,
    ...unreviewed,
  ]) {
    const key = str(record["fingerprint"]);
    if (!byFingerprint.has(key)) byFingerprint.set(key, record);
  }
  const records = [...byFingerprint.values()].toSorted((a, b) =>
    str(a["fingerprint"]) < str(b["fingerprint"]) ? -1 : 1,
  );
  const file = path.join(dir, "findings.json");
  writeJson(file, records);
  writeJson(path.join(dir, "unverified.json"), verified.unverified);
  const incompleteReason =
    unreviewed.length > 0
      ? "validation_budget_exhausted"
      : verified.unverified.length > 0
        ? "candidate_validation_incomplete"
        : undefined;
  if (incompleteReason !== undefined) {
    updateMetadata(dir, {
      run_status: "incomplete",
      incomplete_reason: incompleteReason,
    });
  }
  const counts: Record<string, number> = {};
  for (const record of records) {
    const verdict = str(record["verdict"]);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
  }
  return {
    outputDir: dir,
    file,
    total: records.length,
    counts,
    unverified: verified.unverified.length,
    unreviewed: unreviewed.length,
    confirmed: records.filter(record => record["verdict"] === "confirmed"),
  };
};
