/**
 * @file The audit's report writer. It derives `REPORT.md`, `FINDINGS-DETAIL.md`
 *   and `NEEDS-VALIDATION.md` from the final records, the ledger and the run's
 *   metadata (the skill's Phase 6), so prose never disagrees with the JSON: the
 *   report agent supplies only the posture summary and the hardening and
 *   positive notes. The run's profile, its partial-coverage statement and
 *   anything unreviewed, unverified or disputed are always stated. The files
 *   stay in the run's folder under `~/.ork/audits`, never the checkout.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { isObject, type Json, str } from "./json.ts";
import { bullets, cell, get, lines, section, strings } from "./markdown.ts";
import { outputDir, readObject, readRows } from "./store.ts";

type Env = Record<string, string | undefined>;

export type ReportInput = {
  /** One short paragraph on the security posture, from the report agent. */
  posture?: string | undefined;
  hardening?: readonly unknown[] | undefined;
  positive?: readonly unknown[] | undefined;
  /** `scan`'s records and notes. */
  scanner?: readonly unknown[] | undefined;
  notes?: readonly unknown[] | undefined;
  /** The earlier audit's folder, when `scan` found one. */
  previous?: string | null | undefined;
};

const place = (record: Json): string => {
  const raw: unknown = record["trace"];
  const trace: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const last = trace.at(-1);
  const file = str(get(last, "file"));
  const line = get(last, "line");
  return file === "" ? "" : `${file}:${typeof line === "number" ? line : ""}`;
};

const severityOf = (record: Json): string =>
  str(get(record, "severity", "overall_severity"));

const SERIOUS = new Set(["medium", "high", "critical"]);

const countBy = (rows: Json[], key: string): string =>
  Object.entries(
    rows.reduce<Record<string, number>>((counts, row) => {
      counts[str(row[key])] = (counts[str(row[key])] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");

const detailOf = (record: Json): string[] => [
  `### ${str(record["title"])}`,
  "",
  `Fingerprint: \`${str(record["fingerprint"])}\``,
  "",
  str(record["description"]),
  "",
  "Trace:",
  ...bullets(record["trace"]),
  "",
  "Evidence:",
  ...bullets(record["evidence"]),
  "",
];

/** Writes the three reports; returns their paths. */
export const runReport = (
  cwd: string,
  env: Env,
  input: ReportInput,
): { outputDir: string; files: string[] } => {
  const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
  const read = (name: string): Json[] => readRows(path.join(dir, name));
  const records = read("findings.json");
  const confirmed = records.filter(item => item["verdict"] === "confirmed");
  const unresolved = records.filter(
    item => item["verdict"] === "needs_validation",
  );
  const ledger = read("coverage-ledger.json");
  const unreviewed = read("unreviewed.json");
  const unverified = read("unverified.json");
  const disputed = read("disputed.json");
  const metadata = readObject(path.join(dir, "run-metadata.json"));

  const incomplete = str(metadata["run_status"]) === "incomplete";
  const status: string[] = [
    `- Profile: ${str(metadata["profile"])}; target: ${str(metadata["target"])}`,
    `- Source ref: ${str(metadata["source_ref"])}`,
    `- Most agent invocations the profile allows: ${typeof metadata["budget"] === "number" ? metadata["budget"] : ""}`,
    "- Execution: source review only. No audited code was run: Ork has no OS-enforced sandbox yet, so every lead that needs execution is a `needs_validation` record.",
    `- Prior audit: ${(input.previous ?? "") === "" ? "none found" : "read from an earlier folder of this project"}`,
    `- Run status: ${str(metadata["run_status"])}${incomplete ? ` (${str(metadata["incomplete_reason"])})` : ""}`,
  ];
  const caveats: string[] = [];
  if (metadata["partial_coverage"] === true) {
    caveats.push(
      "**This is a partial pass.** The profile or scope bounds it: units not hunted are `deferred` in the ledger, and one run never exhausts the target.",
    );
  }
  if (unreviewed.length > 0) {
    caveats.push(
      `**Candidate validation is incomplete.** ${unreviewed.length} candidate(s) came back past the profile's verifier cap and no verifier tried to disprove them; they are \`needs_validation\` leads that were not looked at: ${unreviewed.map(item => `\`${str(item["fingerprint"])}\``).join(", ")}.`,
    );
  }
  if (unverified.length > 0) {
    caveats.push(
      `**${unverified.length} candidate(s) have no usable verifier record and are not findings:**`,
      ...unverified.map(
        item => `- \`${str(item["fingerprint"])}\`: ${str(item["reason"])}`,
      ),
    );
  }
  if (disputed.length > 0) {
    caveats.push(
      `**${disputed.length} confirmed record(s) were removed after the recheck and are not findings:**`,
      ...disputed.map(
        item =>
          `- \`${str(item["fingerprint"])}\` (${str(item["title"])}): ${str(item["reason"])}`,
      ),
    );
  }
  caveats.push(
    "The ledger's hunted units stay `planned` (assigned): the hunters' per-unit outcomes are not recorded in this version.",
  );

  const report = [
    "# Security audit report",
    "",
    ...section("Run", [...status, "", ...caveats]),
    ...section(
      "Posture",
      [str(input.posture)].filter(text => text !== ""),
    ),
    ...section(
      "Confirmed findings",
      [
        "| Severity | Title | Where | Fingerprint |",
        "| --- | --- | --- | --- |",
        ...confirmed.map(
          item =>
            `| ${severityOf(item)} | ${cell(item["title"])} | ${cell(place(item))} | \`${str(item["fingerprint"])}\` |`,
        ),
        ...(confirmed.length === 0 ? [] : [""]),
        ...confirmed.flatMap(item => [
          `### ${str(item["title"])} (${severityOf(item)})`,
          "",
          `Where: ${place(item)}`,
          "",
          str(item["description"]),
          "",
          `Root cause: ${str(item["root_cause"])}`,
          "",
          `Result: ${str(get(item, "execution", "observed_result"))}`,
          "",
          `Impact: ${str(get(item, "severity", "impact", "reason"))}`,
          "",
          `Likelihood: ${str(get(item, "severity", "likelihood", "reason"))}`,
          "",
          `Smallest fix: ${str(get(item, "remediation", "strategy"))}`,
          "",
        ]),
      ].filter(line => confirmed.length > 0 || !line.startsWith("|")),
    ),
    ...section(
      "Needs validation",
      [
        "| Title | Where | Blocker | Fingerprint |",
        "| --- | --- | --- | --- |",
        ...unresolved.map(
          item =>
            `| ${cell(item["title"])} | ${cell(place(item))} | ${cell(strings(Array.isArray(item["blockers"]) ? item["blockers"] : []).join("; "))} | \`${str(item["fingerprint"])}\` |`,
        ),
      ].filter(line => unresolved.length > 0 || !line.startsWith("|")),
    ),
    ...section("Scanner findings (no model, not part of findings.json)", [
      ...strings(input.notes).map(note => `- Note: ${note}`),
      ...(input.scanner ?? [])
        .filter(item => isObject(item))
        .map(
          item =>
            `- [${str(item["severity"])}] ${str(item["title"])} (\`${str(item["fingerprint"])}\`)`,
        ),
    ]),
    ...section(
      "Hardening notes",
      strings(input.hardening).map(note => `- ${note}`),
    ),
    ...section(
      "Positive source patterns",
      strings(input.positive).map(note => `- ${note}`),
    ),
    ...section("Coverage", [
      `- Units in the ledger: ${ledger.length} (${countBy(ledger, "status")})`,
      "- `deferred` units were not hunted; `planned` units were assigned to a hunter.",
    ]),
  ].join("\n");

  const serious = confirmed.filter(item => SERIOUS.has(severityOf(item)));
  const detail = [
    "# Confirmed findings in detail",
    "",
    ...(serious.length === 0
      ? ["No confirmed finding of medium severity or above."]
      : serious.flatMap(item =>
          lines(
            detailOf(item),
            `Severity: ${severityOf(item)}`,
            "",
            "Conditions:",
            bullets(item["conditions"]),
            "",
            "Reproduction (target-neutral, bounded, from the record):",
            bullets(item["execution"]),
            "",
            "Remediation:",
            bullets(item["remediation"]),
            "",
          ),
        )),
  ].join("\n");

  const needs = [
    "# Leads that need validation",
    "",
    "Prioritized leads with no severity. None is a confirmed vulnerability; resolve each by the bounded local step or the owner-observed check below, never by testing a live system.",
    "",
    ...(unresolved.length === 0
      ? ["No lead is waiting on validation."]
      : unresolved.flatMap(item =>
          lines(
            detailOf(item),
            "Blockers:",
            bullets(item["blockers"]),
            "",
            "Resolution plan:",
            bullets(item["validation_plan"]),
            "",
          ),
        )),
  ].join("\n");

  const files = [
    ["REPORT.md", report],
    ["FINDINGS-DETAIL.md", detail],
    ["NEEDS-VALIDATION.md", needs],
  ].map(([name, text]) => {
    const file = path.join(dir, name ?? "");
    writeFileSync(file, `${text}\n`);
    return file;
  });
  return { outputDir: dir, files };
};
