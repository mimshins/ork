/**
 * @file Static checks of a GitHub Actions workflow file: actions not pinned to
 *   a full commit SHA, jobs that declare no `permissions`, and
 *   `pull_request_target` combined with a checkout. A line scan, not a YAML
 *   parse (the tools have no YAML dependency, and a workflow's `jobs:`, `uses:`
 *   and `permissions:` keys are plain block-style lines). shortcut: flow-style
 *   jobs (`jobs: {a: {…}}`) are not seen; upgrade when a workflow here uses
 *   one. A job counts as declaring permissions only with its own `permissions:`
 *   key. A workflow-level block does not count: the plan asks for them per job,
 *   so a job never relies on a default another edit can widen.
 */

import { fingerprintOf, type ScannerRecord } from "./records.ts";

const SHA = /^[0-9a-f]{40}$/u;

const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/** A line without its trailing `# comment`. */
const code = (line: string): string => line.replace(/(?:^|\s)#.*$/u, "");

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"']+)/u;

/** Why a `uses:` value isn't pinned, or undefined when it is (or is local). */
const unpinnedReason = (value: string): string | undefined => {
  if (value.startsWith("./")) return undefined;
  if (value.startsWith("docker://")) {
    return value.includes("@sha256:")
      ? undefined
      : "a container image not pinned to a digest";
  }
  const ref = value.includes("@")
    ? value.slice(value.lastIndexOf("@") + 1)
    : "";
  return SHA.test(ref)
    ? undefined
    : `a ref (${ref || "none"}), not a full commit SHA`;
};

type Job = { name: string; line: number; permissions: boolean };

/** The jobs under a top-level `jobs:` key, and whether each has `permissions:`. */
const jobsOf = (lines: readonly string[]): Job[] => {
  const start = lines.findIndex(line => /^jobs:\s*$/u.test(code(line)));
  if (start < 0) return [];
  const jobs: Job[] = [];
  let jobIndent = -1;
  let childIndent = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = code(lines[index] ?? "");
    if (text.trim() === "") continue;
    const indent = indentOf(text);
    if (indent === 0) break;
    if (jobIndent < 0) jobIndent = indent;
    const header = /^(?:[A-Za-z0-9_.-]+|"[^"]+"|'[^']+'):\s*$/u.exec(
      text.trim(),
    );
    if (indent === jobIndent && header !== null) {
      jobs.push({
        name: text.trim().slice(0, -1),
        line: index + 1,
        permissions: false,
      });
      childIndent = -1;
      continue;
    }
    const job = jobs.at(-1);
    if (job === undefined) continue;
    if (childIndent < 0) childIndent = indent;
    if (indent === childIndent && text.trim().startsWith("permissions:")) {
      job.permissions = true;
    }
  }
  return jobs;
};

/** Findings for one workflow file (`file` is its repository-relative path). */
export const checkWorkflow = (file: string, text: string): ScannerRecord[] => {
  const lines = text.split("\n");
  const records: ScannerRecord[] = [];

  lines.forEach((raw, index) => {
    const value = USES.exec(code(raw))?.[1];
    const reason = value === undefined ? undefined : unpinnedReason(value);
    if (value === undefined || reason === undefined) return;
    records.push({
      source: "scanner",
      check: "unpinned-action",
      fingerprint: fingerprintOf("scanner", "unpinned-action", file, value),
      title: `${file} uses ${value}: ${reason}`,
      severity: "moderate",
      file,
      line: index + 1,
    });
  });

  for (const job of jobsOf(lines)) {
    if (job.permissions) continue;
    records.push({
      source: "scanner",
      check: "missing-permissions",
      fingerprint: fingerprintOf(
        "scanner",
        "missing-permissions",
        file,
        job.name,
      ),
      title: `${file}: job ${job.name} declares no permissions`,
      severity: "low",
      file,
      line: job.line,
    });
  }

  const triggers = lines.some(raw =>
    /\bpull_request_target\b/u.test(code(raw)),
  );
  if (triggers) {
    lines.forEach((raw, index) => {
      if (!/^\s*(?:-\s+)?uses:\s*["']?actions\/checkout@/u.test(code(raw)))
        return;
      records.push({
        source: "scanner",
        check: "pull-request-target-checkout",
        fingerprint: fingerprintOf(
          "scanner",
          "pull-request-target-checkout",
          file,
          index + 1,
        ),
        title: `${file} runs on pull_request_target and checks out code`,
        severity: "high",
        file,
        line: index + 1,
      });
    });
  }
  return records;
};
