/**
 * @file The audit's `scan` step: checks the inputs, then runs the free,
 *   deterministic scanners (`pnpm audit`, the workflow checks, the secret
 *   patterns) and reads the previous audit. It costs no tokens. Its result is
 *   one JSON document; the scanner findings are `scanner` records for the
 *   report.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { checkInputs, resolveScope, type Scope } from "./inputs.ts";
import { fingerprintOf, type ScannerRecord } from "./records.ts";
import { SECRET_PATTERNS } from "./secret-patterns.ts";
import { outputDir, previousAudit, type PreviousAudit } from "./store.ts";
import { checkWorkflow } from "./workflow-checks.ts";

type Env = Record<string, string | undefined>;

export type AuditRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

/** Runs `pnpm audit --json`; its exit code is data, never a failure here. */
export type AuditRunner = (cwd: string) => AuditRun;

export type ScanResult = {
  profile: string;
  scope: Scope;
  runId: string;
  outputDir: string;
  findings: ScannerRecord[];
  /** What the scan could not do (for example `pnpm audit` offline). */
  notes: string[];
  previous: PreviousAudit | null;
};

const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;

const severityOf = (value: unknown): ScannerRecord["severity"] =>
  SEVERITIES.find(item => item === value) ?? "info";

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Advisories from `pnpm audit --json`, as records, or a note on why not. */
export const parsePnpmAudit = (
  run: AuditRun,
): { records: ScannerRecord[]; notes: string[] } => {
  // pnpm exits non-zero when there are advisories: the JSON, not the code, says.
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    const why = run.stderr.trim().split("\n")[0] ?? "";
    return {
      records: [],
      notes: [
        `pnpm audit could not run${why === "" ? "" : `: ${why.slice(0, 200)}`} (exit ${run.status ?? "none"}); dependency advisories were not checked.`,
      ],
    };
  }
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

const MAX_FILE_BYTES = 1_000_000;

/** Secret-pattern hits in `files`: file, line and the pattern's name only. */
export const scanSecrets = (
  files: readonly { path: string; text: string }[],
): ScannerRecord[] =>
  files.flatMap(file =>
    file.text.split("\n").flatMap((line, index) =>
      SECRET_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(
        ({ name }): ScannerRecord => ({
          source: "scanner",
          check: "secret-pattern",
          fingerprint: fingerprintOf(
            "scanner",
            "secret-pattern",
            file.path,
            index + 1,
            name,
          ),
          title: `${file.path}:${index + 1} matches the secret pattern ${name}`,
          severity: "high",
          file: file.path,
          line: index + 1,
          pattern: name,
        }),
      ),
    ),
  );

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Tracked text files, read (large or binary ones are skipped). */
const trackedFiles = (cwd: string): { path: string; text: string }[] =>
  git(cwd, ["ls-files", "-z"])
    .split("\0")
    .filter(name => name !== "")
    .flatMap(name => {
      try {
        const file = path.join(cwd, name);
        if (statSync(file).size > MAX_FILE_BYTES) return [];
        const data = readFileSync(file);
        return data.subarray(0, 8000).includes(0)
          ? []
          : [{ path: name, text: data.toString("utf8") }];
      } catch {
        // tracked but gone from the working tree
        return [];
      }
    });

const realAudit: AuditRunner = cwd => {
  const result = spawnSync("pnpm", ["audit", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
};

export type ScanOptions = {
  cwd: string;
  env: Env;
  audit?: AuditRunner;
};

/** Checks the inputs first, then runs every scanner. Throws on a bad input. */
export const runScan = ({
  cwd,
  env,
  audit = realAudit,
}: ScanOptions): ScanResult => {
  const inputs = checkInputs(env["PROFILE"], env["SCOPE"]);
  const runId = env["ORK_RUN"] ?? "";
  const dir = outputDir(cwd, runId, env);

  const scope = resolveScope(inputs.scope, ref =>
    git(cwd, ["diff", "--name-only", ref])
      .split("\n")
      .filter(name => name !== ""),
  );
  const pnpm = parsePnpmAudit(audit(cwd));
  const files = trackedFiles(cwd);
  const workflows = files
    .filter(
      file =>
        file.path.startsWith(".github/workflows/") &&
        /\.ya?ml$/u.test(file.path),
    )
    .flatMap(file => checkWorkflow(file.path, file.text));
  return {
    profile: inputs.profile,
    scope,
    runId,
    outputDir: dir,
    findings: [...pnpm.records, ...workflows, ...scanSecrets(files)],
    notes: pnpm.notes,
    previous: previousAudit(cwd, runId, env),
  };
};
