/**
 * @file The git producers of the `extract` tool (RFC-023): `search` (`git grep
 *   -E`) and `git` (`diff`, `show`, `log`). Nothing runs a shell: git is run
 *   with `execFile`, fixed arguments, no pager, no external diff or textconv,
 *   no prompt, literal pathspecs, a timeout and an output cap. No value from a
 *   call goes in a flag position: a revision must look like one and is checked
 *   to name a commit, a pattern follows `-e`, a path follows `--`. A denied
 *   file's hits are dropped and its section of a diff is replaced by `[refused:
 *   <path>]`.
 */

import { execFile } from "node:child_process";

import { type Denied, readable, Refused } from "./contain.ts";
import { badStep, REV_PATH, StepError } from "./extract-error.ts";

export type SearchStep = {
  step: "search";
  /** POSIX extended regular expression (`git grep -E`). */
  pattern: string;
  path?: string;
  ignoreCase?: boolean;
  maxMatches?: number;
};

export type GitStep = {
  step: "git";
  op: "diff" | "show" | "log";
  ref?: string;
  base?: string;
  staged?: boolean;
  path?: string;
  n?: number;
};

export const GIT_TIMEOUT_MS = 10_000;
export const GIT_OUTPUT_CAP = 1024 * 1024;
export const DEFAULT_MATCHES = 50;
export const MAX_MATCHES = 200;
export const DEFAULT_LOG = 20;
export const MAX_LOG = 50;

/** A revision: no leading dash (a flag) and no colon (`rev:path`). */
export const REF = /^[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*$/u;

export type GitResult = { out: string; cut: boolean; code: number };

export const linesOf = (value: string): string[] =>
  value === "" ? [] : value.replace(/\n$/u, "").split("\n");

const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_LITERAL_PATHSPECS: "1",
  // A diff refreshes the index; a session's own git calls must not meet a lock.
  GIT_OPTIONAL_LOCKS: "0",
});

/** Runs git without a shell; exit 1 with nothing on stderr is a result. */
const git = (cwd: string, args: readonly string[]): Promise<GitResult> =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "--no-pager",
        "-c",
        "core.quotePath=false",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
        cwd,
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: GIT_OUTPUT_CAP,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ out: stdout, cut: false, code: 0 });
        } else if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({ out: stdout, cut: true, code: 0 });
        } else if (error.killed === true) {
          reject(new StepError("git timed out after 10 s"));
        } else if (error.code === 1 && stderr.trim() === "") {
          resolve({ out: stdout, cut: false, code: 1 });
        } else if (error.code === "ENOENT") {
          reject(new StepError("git not found"));
        } else if (/not a git repository/u.test(stderr)) {
          reject(new StepError("not a git repository"));
        } else {
          const first = stderr.trim().split("\n")[0] ?? "";
          reject(new StepError(`git failed: ${first || "no message"}`));
        }
      },
    );
  });

/** The same runner, for the `files` producer and the `regex` cut. */
export const runGit = git;
/** Git's output without the trailing newline, saying when it was cut. */
const noted = ({ out, cut }: GitResult): string =>
  cut
    ? `${out.slice(0, out.lastIndexOf("\n") + 1)}[git output cut at 1 MiB]`
    : out.replace(/\n$/u, "");

/** A path for git, after `--`: contained, not denied, relative to `cwd`. */
const gitPath = (cwd: string, asked: string, denied: Denied): string =>
  readable(cwd, asked, denied).rel;

const commitOf = async (cwd: string, rev: string): Promise<string> => {
  const result = await git(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${rev}^{commit}`,
  ]).catch((error: unknown) => {
    // A blob or tree id fails with a message; a missing repository still says so.
    if (error instanceof StepError && error.message.startsWith("git failed")) {
      return null;
    }
    throw error;
  });
  if (result?.code !== 0) throw badStep(`not a commit: ${rev}`);
  return result.out.trim();
};

const sideOf = (cwd: string, side: string): Promise<string> =>
  side === "" ? Promise.resolve("") : commitOf(cwd, side);

/**
 * `rev` (or each side of an `a..b` / `a...b` range) as a commit id: a blob or
 * tree id would show a file's content past the deny list.
 */
const revisionOf = async (cwd: string, rev: string): Promise<string> => {
  if (!REF.test(rev)) {
    const why = rev.includes(":") ? REV_PATH : "not a plain revision";
    throw new Refused(`refused: ref ${rev} (${why})`);
  }
  const range = /^(.*?)(\.\.\.?)(.*)$/u.exec(rev);
  if (range === null) return commitOf(cwd, rev);
  const [, left = "", dots = "", right = ""] = range;
  const [from, to] = await Promise.all([sideOf(cwd, left), sideOf(cwd, right)]);
  return `${from}${dots}${to}`;
};

const ESCAPES: Readonly<Record<string, string>> = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * A name git C-quoted. With `core.quotePath=false` only control characters come
 * as octal, so each one is a single byte.
 */
const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value
        .slice(1, -1)
        .replaceAll(/\\([0-7]{3}|.)/gsu, (_, escaped: string) =>
          /^[0-7]{3}$/u.test(escaped)
            ? String.fromCodePoint(Number.parseInt(escaped, 8))
            : (ESCAPES[escaped] ?? escaped),
        )
    : value;

const SECTION = /^diff --(?:git|cc|combined) /u;
const COMMIT = /^commit [0-9a-f]{7,}/u;

/**
 * Every path a section header could name. `a/X b/Y` is ambiguous when names
 * hold ` b/`, so each split is a candidate: a section is refused when any is.
 */
const headerPaths = (line: string): string[] => {
  const rest = line.replace(SECTION, "");
  if (!line.startsWith("diff --git ")) return [unquote(rest)];
  return [" b/", ' "b/']
    .flatMap(separator => {
      const pairs: string[] = [];
      for (
        let at = rest.indexOf(separator);
        at !== -1;
        at = rest.indexOf(separator, at + 1)
      ) {
        pairs.push(rest.slice(0, at), rest.slice(at + 1));
      }
      return pairs;
    })
    .map(name => unquote(name).replace(/^[ab]\//u, ""));
};

/** Diff output with each denied file's section replaced by one line. */
const refuseSections = (out: string, denied: Denied): string => {
  const kept: string[] = [];
  let skipping = false;
  for (const line of out.split("\n")) {
    if (SECTION.test(line)) {
      const hit = headerPaths(line).find(name => denied(name));
      skipping = hit !== undefined;
      kept.push(hit === undefined ? line : `[refused: ${hit}]`);
    } else if (COMMIT.test(line)) {
      // The next commit of a range ends a refused section.
      skipping = false;
      kept.push(line);
    } else if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join("\n");
};

export const searchStep = async (
  cwd: string,
  step: SearchStep,
  denied: Denied,
): Promise<string> => {
  const where = gitPath(cwd, step.path ?? ".", denied);
  const result = await git(cwd, [
    "grep",
    "-E",
    "-n",
    "-I",
    "--null",
    "--untracked",
    // A `color.*` setting would wrap names in escapes the deny check can't read.
    "--no-color",
    ...(step.ignoreCase === true ? ["-i"] : []),
    "-e",
    step.pattern,
    "--",
    where,
  ]);
  // `path\0line\0text`; a line cut short by the cap has fewer parts.
  const hits = linesOf(result.out)
    .map(line => line.split("\0"))
    .filter(parts => parts.length >= 3 && !denied(parts[0] ?? ""))
    .map(([file, no, ...text]) => `${file}:${no}: ${text.join("\0")}`);
  const max = Math.min(step.maxMatches ?? DEFAULT_MATCHES, MAX_MATCHES);
  const more = hits.length - max;
  return [
    ...(hits.length === 0 ? ["[no matches]"] : hits.slice(0, max)),
    ...(more > 0 ? [`[${more} more matches: narrow the pattern or path]`] : []),
    ...(result.cut ? ["[git output cut at 1 MiB]"] : []),
  ].join("\n");
};

/** Diff options no repository config can change. */
const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--relative",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export const gitStep = async (
  cwd: string,
  step: GitStep,
  denied: Denied,
): Promise<string> => {
  const paths =
    step.path === undefined ? [] : ["--", gitPath(cwd, step.path, denied)];
  if (step.op === "log") {
    const n = Math.min(Math.max(step.n ?? DEFAULT_LOG, 1), MAX_LOG);
    const revs =
      step.ref === undefined ? [] : [await revisionOf(cwd, step.ref)];
    return noted(
      await git(cwd, [
        "log",
        "--no-color",
        "--oneline",
        "-n",
        String(n),
        ...revs,
        ...paths,
      ]),
    );
  }
  const args =
    step.op === "show"
      ? ["show", ...DIFF_FLAGS, await revisionOf(cwd, step.ref ?? "HEAD")]
      : [
          "diff",
          ...DIFF_FLAGS,
          ...(step.staged === true ? ["--cached"] : []),
          ...(step.base === undefined
            ? []
            : [await revisionOf(cwd, step.base)]),
        ];
  return refuseSections(noted(await git(cwd, [...args, ...paths])), denied);
};
