/**
 * @file The audit's dependency-advisory scanners: which one a project's
 *   lockfile names (`pnpm audit` or `npm audit`), and each one's `--json`
 *   output read into `scanner` records. A scanner that could not run is a note,
 *   never a failure.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { fingerprintOf, type ScannerRecord } from "./records.ts";

export type AuditRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type AuditTool = "pnpm" | "npm";

/** Runs `<tool> audit --json`; its exit code is data, never a failure here. */
export type AuditRunner = (cwd: string, tool: AuditTool) => AuditRun;

const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;

const severityOf = (value: unknown): ScannerRecord["severity"] =>
  SEVERITIES.find(item => item === value) ?? "info";

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type Advisories = { records: ScannerRecord[]; notes: string[] };

/** The note for a scanner that gave no usable JSON (offline, no registry). */
const couldNotRun = (
  tool: AuditTool,
  run: AuditRun,
  why: string,
): Advisories => {
  const first = (why === "" ? run.stderr.trim().split("\n")[0] : why) ?? "";
  return {
    records: [],
    notes: [
      `${tool} audit could not run${first === "" ? "" : `: ${first.slice(0, 200)}`} (exit ${run.status ?? "none"}); dependency advisories were not checked.`,
    ],
  };
};

const parseJson = (stdout: string): unknown => {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
};

/** Advisories from `pnpm audit --json`, as records, or a note on why not. */
export const parsePnpmAudit = (run: AuditRun): Advisories => {
  // pnpm exits non-zero when there are advisories: the JSON, not the code, says.
  const parsed = parseJson(run.stdout);
  if (parsed === undefined) return couldNotRun("pnpm", run, "");
  const advisories: unknown =
    typeof parsed === "object" && parsed !== null && "advisories" in parsed
      ? parsed.advisories
      : undefined;
  const list: unknown[] = Array.isArray(advisories)
    ? advisories
    : typeof advisories === "object" && advisories !== null
      ? Object.values(advisories)
      : [];
  const records = list.flatMap((item): ScannerRecord[] => {
    if (!isRecord(item)) return [];
    const advisory = item;
    const name = text(advisory["module_name"], "unknown package");
    const rawId = advisory["id"];
    const id =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId)
        : text(advisory["title"], "advisory");
    return [
      {
        source: "scanner",
        check: "pnpm-audit",
        fingerprint: fingerprintOf("scanner", "pnpm-audit", name, id),
        title: `${name}: ${text(advisory["title"], "advisory")}`,
        severity: severityOf(advisory["severity"]),
        detail: [
          `vulnerable ${text(advisory["vulnerable_versions"], "?")}`,
          `patched ${text(advisory["patched_versions"], "?")}`,
          text(advisory["url"], ""),
        ]
          .filter(part => part !== "")
          .join("; "),
      },
    ];
  });
  return { records, notes: [] };
};

/**
 * Advisories from `npm audit --json` (npm 7 and later: a `vulnerabilities` map
 * whose `via` entries are advisory objects or, for a package that is vulnerable
 * only through another, the other's name), or a note on why not.
 */
export const parseNpmAudit = (run: AuditRun): Advisories => {
  const parsed = parseJson(run.stdout);
  if (!isRecord(parsed)) return couldNotRun("npm", run, "");
  // Offline or no registry: npm prints `{ "error": { "summary": … } }`.
  const failure = parsed["error"];
  if (isRecord(failure)) {
    return couldNotRun(
      "npm",
      run,
      text(failure["summary"], text(failure["code"], "")),
    );
  }
  const vulnerabilities = parsed["vulnerabilities"];
  const packages = isRecord(vulnerabilities)
    ? Object.entries(vulnerabilities)
    : [];
  const records = packages.flatMap(([key, entry]): ScannerRecord[] => {
    const via: unknown[] =
      isRecord(entry) && Array.isArray(entry["via"]) ? entry["via"] : [];
    return via.flatMap((advisory): ScannerRecord[] => {
      if (!isRecord(advisory)) return [];
      const name = text(advisory["name"], key);
      const rawId = advisory["source"];
      const id =
        typeof rawId === "string" || typeof rawId === "number"
          ? String(rawId)
          : text(advisory["title"], "advisory");
      return [
        {
          source: "scanner",
          check: "npm-audit",
          fingerprint: fingerprintOf("scanner", "npm-audit", name, id),
          title: `${name}: ${text(advisory["title"], "advisory")}`,
          severity: severityOf(advisory["severity"]),
          detail: [
            `vulnerable ${text(advisory["range"], "?")}`,
            text(advisory["url"], ""),
          ]
            .filter(part => part !== "")
            .join("; "),
        },
      ];
    });
  });
  // The same advisory comes under each package it reaches: keep one.
  const unique = [
    ...new Map(records.map(record => [record.fingerprint, record])).values(),
  ];
  return { records: unique, notes: [] };
};

/**
 * The advisory scanner for a project, by its lockfile: pnpm first when both
 * exist; null when there is neither.
 */
export const chooseScanner = (cwd: string): AuditTool | null =>
  existsSync(path.join(cwd, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(path.join(cwd, "package-lock.json"))
      ? "npm"
      : null;
