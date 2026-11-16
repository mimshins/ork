/**
 * @file The audit's `scan` step: checks the inputs and that the audit's files
 *   are inside the checkout, then runs the free, deterministic scanners (`pnpm
 *   audit` or `npm audit` by lockfile, the workflow checks, the secret
 *   patterns) and reads the previous audit. It costs no tokens. Its result is
 *   one JSON document; the scanner findings are `scanner` records for the
 *   report.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
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

/** The real path of `target`, or `target` itself when it cannot be resolved. */
const resolved = (target: string): string => {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
};

/**
 * Whether the audit's own folder is outside the project root (`ork register`
 * keeps Ork's files outside the checkout; the agents there cannot read it).
 */
export const bundleOutsideRoot = (root: string, bundleDir: string): boolean => {
  const relative = path.relative(resolved(root), resolved(bundleDir));
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
};

export const OUTSIDE_ROOT_MESSAGE =
  "the audit needs its files inside the checkout; use ork init (ork register keeps Ork's files outside it)";

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

const realAudit: AuditRunner = (cwd, tool) => {
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
  /** The folder the audit's scripts are in; when set, it must be inside `cwd`. */
  bundleDir?: string;
};

/**
 * Checks the inputs, then that the bundle is inside the checkout, then runs
 * every scanner. Throws on a bad input or an outside bundle, before anything is
 * run or made.
 */
export const runScan = ({
  cwd,
  env,
  audit = realAudit,
  bundleDir,
}: ScanOptions): ScanResult => {
  const inputs = checkInputs(env["PROFILE"], env["SCOPE"]);
  if (bundleDir !== undefined && bundleOutsideRoot(cwd, bundleDir)) {
    throw new Error(OUTSIDE_ROOT_MESSAGE);
  }
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
    notes: advisories.notes,
    previous: previousAudit(cwd, runId, env),
  };
};
