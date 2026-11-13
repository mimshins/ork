/**
 * @file The audit's `consolidate` and `findings` steps. `consolidate` dedupes
 *   the hunters' candidates by fingerprint and passes on at most the profile's
 *   number to the verifiers; the others become `needs_validation` records that
 *   say they were not looked at (`findings` keeps one the validator refuses out
 *   of `findings.json`, as `unverified`), and a coverage gap the critic
 *   accepted is recorded as `deferred` in the ledger. `findings` writes
 *   `findings.json` (sorted by fingerprint, as `validate-findings.cjs`
 *   requires) from the verifiers' records and those unreviewed ones (in
 *   `verdicts.ts`).
 */

import path from "node:path";

import { checkInputs, type Inputs } from "./inputs.ts";
import { isObject, type Json, objects, str, writeJson } from "./json.ts";
import { PROFILES } from "./profiles.ts";
import { outputDir, readRows } from "./store.ts";

type Env = Record<string, string | undefined>;

/** A candidate a hunter reports (the skill's trace and evidence shapes). */
export type Candidate = {
  fingerprint: string;
  title: string;
  description: string;
  claimed_root_cause?: string;
  trace: unknown[];
  evidence: unknown[];
};

/** A hunt's output (`{ candidates: [...] }`) or a bare candidate, flattened. */
const candidatesOf = (hunts: readonly unknown[]): Json[] =>
  hunts.flatMap(hunt => {
    if (!isObject(hunt)) return [];
    const list = hunt["candidates"];
    if (Array.isArray(list)) return objects(list);
    return typeof hunt["fingerprint"] === "string" ? [hunt] : [];
  });

/**
 * `trace` with each entry's kind set by its place, as the skill's validator
 * requires: the first `entrypoint`, the last `sink`, the ones between
 * `propagation`, and a one-entry trace `sink`. The agents list a trace in order
 * and Ork labels it, so a mislabelled entry can't cost a paid record.
 */
export const labelTrace = (trace: unknown): unknown => {
  if (!Array.isArray(trace)) return trace;
  const last = trace.length - 1;
  return trace.map((entry: unknown, at) => {
    if (!isObject(entry)) return entry;
    const kind = at === last ? "sink" : at === 0 ? "entrypoint" : "propagation";
    return { ...entry, kind };
  });
};

/** The `needs_validation` record for a candidate no verifier got to. */
export const unreviewedRecord = (candidate: Json, cap: number): Json => ({
  verdict: "needs_validation",
  fingerprint: candidate["fingerprint"],
  title: candidate["title"],
  description: candidate["description"],
  claimed_root_cause:
    candidate["claimed_root_cause"] ??
    candidate["root_cause"] ??
    candidate["description"],
  trace: labelTrace(candidate["trace"]),
  evidence: candidate["evidence"],
  blockers: [
    `Not looked at: more candidates came back than the profile's ${cap} verifier runs allow, so no verifier tried to disprove this one.`,
  ],
  validation_plan: {
    local:
      "Rerun the audit with a larger profile, or read the trace by hand and try to disprove it before trusting it.",
  },
});

export type ConsolidateResult = {
  outputDir: string;
  /** Candidates handed to the verifiers (one fresh session each). */
  unique: Json[];
  /** `needs_validation` records for candidates past the cap. */
  unreviewed: Json[];
  total: number;
  duplicates: number;
  cap: number;
  /** Critic gaps whose coverage ID is not a unit of the ledger. */
  ignoredGaps: string[];
  /** The hunters' non-finding notes, for the report. */
  hardening: string[];
  /** Boundaries the hunters met outside their units, for the report. */
  uncovered: unknown[];
};

/** What every hunt result lists under `key`, flattened. */
const listsOf = (hunts: readonly unknown[], key: string): unknown[] =>
  hunts.flatMap(hunt => {
    const list: unknown = isObject(hunt) ? hunt[key] : undefined;
    const items: readonly unknown[] = Array.isArray(list) ? list : [];
    return [...items];
  });

/**
 * Dedupes by fingerprint (the first wins), caps what goes on, writes
 * `unreviewed.json`, and marks the critic's accepted `gaps` (`[{ coverage_id,
 * reason }]`) as `deferred` in `coverage-ledger.json`.
 */
export const runConsolidate = (
  cwd: string,
  env: Env,
  input: { hunts?: readonly unknown[]; gaps?: readonly unknown[] | undefined },
): ConsolidateResult => {
  const { profile }: Inputs = checkInputs(env["PROFILE"], env["SCOPE"]);
  const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
  const cap = PROFILES[profile].verifiers;

  const all = candidatesOf(input.hunts ?? []);
  const seen = new Set<string>();
  const distinct = all.filter(candidate => {
    const key = str(candidate["fingerprint"]);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const unique = distinct.slice(0, cap);
  const unreviewed = distinct
    .slice(cap)
    .map(item => unreviewedRecord(item, cap));
  writeJson(path.join(dir, "unreviewed.json"), unreviewed);

  const ledgerFile = path.join(dir, "coverage-ledger.json");
  const ledger = readRows(ledgerFile);
  const ids = new Set(ledger.map(unit => unit["coverage_id"]));
  const gaps = objects(input.gaps ?? []);
  const known = gaps.filter(gap => ids.has(gap["coverage_id"]));
  for (const unit of ledger) {
    const gap = known.find(item => item["coverage_id"] === unit["coverage_id"]);
    if (gap === undefined || unit["status"] !== "planned") continue;
    unit["status"] = "deferred";
    unit["unresolved"] = [
      typeof gap["reason"] === "string" && gap["reason"] !== ""
        ? `Coverage gap the critic accepted: ${gap["reason"]}`
        : "Coverage gap the critic accepted; no second wave in this profile.",
    ];
  }
  if (known.length > 0) writeJson(ledgerFile, ledger);

  return {
    outputDir: dir,
    unique,
    unreviewed,
    total: all.length,
    duplicates: all.length - distinct.length,
    cap,
    ignoredGaps: gaps
      .filter(gap => !ids.has(gap["coverage_id"]))
      .map(gap => str(gap["coverage_id"])),
    hardening: listsOf(input.hunts ?? [], "hardening").filter(
      item => typeof item === "string",
    ),
    uncovered: listsOf(input.hunts ?? [], "uncovered"),
  };
};
