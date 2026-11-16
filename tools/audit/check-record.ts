/**
 * @file The audit's `verify` node's `verify:` check (`check-record`): reads the
 *   verifier's report from `$ORK_REPORT` (a file Ork writes, scrubbed, before
 *   each try) and fails with the reasons when its one record would not pass the
 *   skill's validator in the `findings` step, so the same session can fix it
 *   while it still has the source in mind. It names the mistakes verifiers make
 *   most against `report-schema.json`'s branches first, then runs the validator
 *   on the record as `findings` builds it. It reads only the report and runs
 *   nothing from the project.
 */

import { readFileSync } from "node:fs";

import { isObject, type Json, objects, str } from "./json.ts";
import { outputDir } from "./store.ts";
import { finalRecord, recordError } from "./verdicts.ts";

type Env = Record<string, string | undefined>;

const DECISIONS = new Set(["confirmed", "needs_validation", "rejected"]);

/** The report's one record, or why there is none to check. */
const recordOf = (report: unknown): Json | string => {
  if (!isObject(report)) return "the report is not a JSON object";
  const list = report["records"];
  if (!Array.isArray(list) || list.length !== 1 || objects(list).length !== 1) {
    return "`records` must be a list with exactly one record object";
  }
  return objects(list)[0] ?? "`records` has no record";
};

/**
 * The schema mistakes verifiers make most, each with what to do instead; empty
 * when the record has none of them.
 */
export const recordProblems = (report: unknown): string[] => {
  const record = recordOf(report);
  if (typeof record === "string") return [record];
  const problems: string[] = [];
  const decision = isObject(report) ? str(report["decision"]) : "";
  if (!DECISIONS.has(decision)) {
    problems.push("`decision` must be confirmed, needs_validation or rejected");
  }
  if ("scope_note" in record) {
    problems.push(
      "the record has `scope_note`, which the schema does not allow (no extra fields): remove it, and put the scope in each trace entry's `scope`",
    );
  }
  const trace = Array.isArray(record["trace"]) ? record["trace"] : [];
  for (const [at, entry] of trace.entries()) {
    if (!isObject(entry) || str(entry["scope"]).trim() === "") {
      problems.push(
        `trace[${String(at)}] has no \`scope\`: every trace entry needs file, line, scope and description`,
      );
    }
    if (isObject(entry) && "scope_note" in entry) {
      problems.push(
        `trace[${String(at)}] has \`scope_note\`, which the schema does not allow: use \`scope\``,
      );
    }
  }
  const execution = record["execution"];
  if (isObject(execution) && typeof execution["instructions"] === "string") {
    problems.push(
      "`execution.instructions` is a string: it must be a list of strings, one step each",
    );
  }
  const remediation = record["remediation"];
  if (isObject(remediation) && "fixes" in remediation) {
    problems.push(
      "`remediation.fixes` is not in the schema: use `strategy` (prose) and, if any, `code_changes` (each file_name and fixed_code)",
    );
  }
  return problems;
};

/** The candidate's fingerprint, from the `forEach` item (`$ORK_ITEM`). */
const itemFingerprint = (env: Env): string => {
  try {
    const item: unknown = JSON.parse(env["ORK_ITEM"] ?? "");
    return isObject(item) ? str(item["fingerprint"]) : "";
  } catch {
    return "";
  }
};

/**
 * Checks the report at `$ORK_REPORT`; throws with every reason when the record
 * would not pass, so the step fails and the session is told why.
 */
export const runCheckRecord = (
  cwd: string,
  env: Env,
): { fingerprint: string; verdict: string } => {
  const file = env["ORK_REPORT"];
  if (file === undefined || file === "") {
    throw new Error("ORK_REPORT is not set: this check runs as a verify: step");
  }
  const report: unknown = JSON.parse(readFileSync(file, "utf8"));
  const problems = recordProblems(report);
  const record = recordOf(report);
  if (problems.length === 0 && typeof record !== "string") {
    const decision = isObject(report) ? str(report["decision"]) : "";
    const final = finalRecord(record, decision, itemFingerprint(env));
    const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
    // Verifiers run side by side: each try gets its own scratch file.
    const error = recordError(
      dir,
      env,
      final,
      decision,
      `check-record-${String(process.pid)}.json`,
    );
    if (error === "") {
      return { fingerprint: str(final["fingerprint"]), verdict: decision };
    }
    problems.push(error);
  }
  throw new Error(
    `The record does not match its branch of report-schema.json:\n- ${problems.join("\n- ")}`,
  );
};
