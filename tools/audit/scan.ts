/**
 * @file The audit's `scan` step: checks the inputs, then runs the free,
 *   deterministic scanners (`pnpm audit` or `npm audit` by lockfile, the
 *   workflow checks, the secret patterns) and reads the previous audit. In an
 *   attached project's per-run copy of `HEAD` it notes the audited commit and
 *   any uncommitted changes it did not see. It costs no tokens. Its result is
 *   one JSON document; the scanner findings are `scanner` records for the
 *   report.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// The package's entry point by path: `tools/` has no workspace link to it.
import {
  SECRET_PATTERNS,
  type SecretPattern,
} from "../../packages/core/src/index.ts";
import {
  type Advisories,
  type AuditRunner,
  chooseScanner,
  parseNpmAudit,
  parsePnpmAudit,
} from "./advisories.ts";
import { checkInputs, resolveScope, type Scope } from "./inputs.ts";
import { fingerprintOf, type ScannerRecord } from "./records.ts";
import { outputDir, previousAudit, type PreviousAudit } from "./store.ts";
import { checkWorkflow } from "./workflow-checks.ts";

type Env = Record<string, string | undefined>;

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

const MAX_FILE_BYTES = 1_000_000;

/** How many characters at the end of a token decide if it is a placeholder. */
const TAIL = 16;

/**
 * Whether a matched token is a test's placeholder, not a credential: the end of
 * it runs through the alphabet or the digits in order, or repeats a character
 * (`ghp_abc…xyz0123456789`, `AKIAABCDEFGHIJKLMNOP`, `sk-ant-xxxx…`). A real
 * token's characters are random, so its tail breaks such a run many times.
 */
export const isPlaceholder = (token: string): boolean => {
  const tail = token.replaceAll(/[^A-Za-z0-9]/gu, "").slice(-TAIL);
  if (tail.length < TAIL) return false;
  let breaks = 0;
  for (let at = 1; at < tail.length; at += 1) {
    const step = (tail.codePointAt(at) ?? 0) - (tail.codePointAt(at - 1) ?? 0);
    if (step !== 0 && step !== 1) breaks += 1;
  }
  return breaks <= 2;
};

/** A key block counts when its key is there: at a line's start, or with a body. */
const isKeyBlock = (line: string, header: RegExp): boolean => {
  const at = line.search(header);
  if (at < 0) return false;
  const rest = line.slice(at).replace(header, "");
  return line.slice(0, at).trim() === "" || /[A-Za-z0-9+/]{40,}/u.test(rest);
};

/** Whether a pattern's hit on `line` is a credential worth reporting. */
const isSecretHit = (
  line: string,
  { name, pattern }: SecretPattern,
): boolean => {
  if (name === "private-key-block") return isKeyBlock(line, pattern);
  const found = pattern.exec(line);
  return found !== null && !isPlaceholder(found[0]);
};

/**
 * Secret-pattern hits in `files`: file, line and the pattern's name only. A
 * test's placeholder (an ordered run, or a key block's header with no key) is
 * left out.
 */
export const scanSecrets = (
  files: readonly { path: string; text: string }[],
): ScannerRecord[] =>
  files.flatMap(file =>
    file.text.split("\n").flatMap((line, index) =>
      SECRET_PATTERNS.filter(each => isSecretHit(line, each)).map(
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

// `tool` is a plain string so a test can run `echo` in place of the scanner.
export const realAudit = (
  cwd: string,
  tool: string,
): ReturnType<AuditRunner> => {
  const result = spawnSync(tool, ["audit", "--json"], {
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

/**
 * What the audit of a per-run copy of `HEAD` (an attached project, where `ork
 * run` sets `ORK_SOURCE_ROOT` to the user's checkout) must say: the audited
 * commit, and that uncommitted changes in the checkout are not audited. Empty
 * when the audit runs in the checkout itself.
 */
const sourceNotes = (cwd: string, env: Env): string[] => {
  const source = env["ORK_SOURCE_ROOT"];
  if (source === undefined || source === "") return [];
  const notes = [
    `audited commit ${git(cwd, ["rev-parse", "HEAD"]).trim()} (a per-run copy of HEAD)`,
  ];
  if (git(source, ["status", "--porcelain"]).trim() !== "") {
    notes.push("uncommitted changes in your checkout are not audited");
  }
  return notes;
};

/**
 * Checks the inputs, then runs every scanner. Throws on a bad input before
 * anything is run or made.
 */
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
  const tool = chooseScanner(cwd);
  const advisories: Advisories =
    tool === null
      ? {
          records: [],
          notes: [
            "no pnpm-lock.yaml or package-lock.json; dependency advisories were not checked.",
          ],
        }
      : (tool === "pnpm" ? parsePnpmAudit : parseNpmAudit)(audit(cwd, tool));
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
    findings: [...advisories.records, ...workflows, ...scanSecrets(files)],
    notes: [...sourceNotes(cwd, env), ...advisories.notes],
    previous: previousAudit(cwd, runId, env),
  };
};
