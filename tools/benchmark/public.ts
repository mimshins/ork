/**
 * @file What a public benchmark in `benchmarks/` may hold, and the scan that
 *   keeps it safe to publish. Files and `summary.json` fields are allowed by
 *   name, so nothing new goes out by accident; every published file is then
 *   searched for what must never be public: a home or temp path, an email, a
 *   token or key, and this machine's own user name, home and git email (read
 *   when the scan runs, never written down). The repository's own public URL is
 *   allowed. Used by `pnpm benchmark:publish` and `pnpm benchmarks:check`.
 */

import { execFileSync } from "node:child_process";
import { homedir, userInfo } from "node:os";

/** The folder in the repository that holds the public benchmarks. */
export const PUBLIC_DIR = "benchmarks";

/** Files a benchmark may hold, as paths inside its own folder. */
const BENCHMARK_FILES = [
  /^README\.md$/u,
  /^summary\.json$/u,
  /^usage\.csv$/u,
  /^inputs\/brief\.md$/u,
  /^inputs\/workflow\/[\w.-]+\.ya?ml$/u,
  /^inputs\/workflow\/agents\/[\w.-]+\.md$/u,
];

/** Files the folder itself may hold, beside the benchmarks. */
export const TOP_FILES = ["README.md", "method.md", "results.json"];

/** The `summary.json` fields that are published; anything else is dropped. */
export const SUMMARY_FIELDS = [
  "benchmark",
  "ork",
  "run",
  "status",
  "runs",
  "started",
  "finished",
  "cost_usd",
  "tokens",
  "turns",
  "sessions",
  "failed_sessions",
  "minutes",
  "decisions",
  "permission_requests",
  "by_node",
  "activations",
  "agents",
  "workflow_commit",
  "result_commits",
] as const;

/** Whether `file` (inside the public folder) may be published at all. */
export const allowedFile = (file: string): boolean => {
  if (TOP_FILES.includes(file)) return true;
  const [name, ...rest] = file.split("/");
  const inner = rest.join("/");
  return (
    name !== undefined &&
    /^[a-z0-9][a-z0-9-]*$/u.test(name) &&
    BENCHMARK_FILES.some(pattern => pattern.test(inner))
  );
};

/** What must never be published, with a name for each. */
const NEVER: [string, RegExp][] = [
  ["a home path", /(?:\/Users\/|\/home\/|C:\\Users\\)[^\s/\\]+/u],
  ["a temp path", /\/(?:private\/)?(?:var\/folders|tmp)\//u],
  ["an email", /[\w.+-]+@[\w-]+\.[\w.-]+/u],
  ["an Anthropic key", /sk-ant-[\w-]{8,}/u],
  ["a GitHub token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{16,}/u],
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["a Slack token", /\bxox[abprs]-[\w-]{10,}/u],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
];

/** Text that may name the owner but is public anyway: the repo's own URLs. */
const PUBLIC_URLS = [
  /(?:https?:\/\/)?(?:github\.com|raw\.githubusercontent\.com)\/[\w.-]+\/ork\b/gu,
  /noreply@anthropic\.com/gu,
];

const gitConfig = (key: string): string => {
  try {
    return execFileSync("git", ["config", key], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/**
 * This machine's own names, which no published file may carry. None in CI,
 * where the user is a word such as `runner` and home paths are caught anyway.
 */
export const localNames = (): string[] =>
  process.env["CI"] === undefined
    ? [
        userInfo().username,
        homedir(),
        gitConfig("user.email"),
        gitConfig("user.name"),
      ].filter(name => name.length >= 3)
    : [];

/** What a published file's text must not hold; empty when it is safe. */
export const findings = (text: string, names: readonly string[]): string[] => {
  const scrubbed = PUBLIC_URLS.reduce((t, url) => t.replaceAll(url, ""), text);
  return [
    ...NEVER.filter(([, pattern]) => pattern.test(scrubbed)).map(
      ([what]) => what,
    ),
    ...names
      .filter(name => scrubbed.includes(name))
      .map(() => "this machine's user name, home or git email"),
  ];
};

/** `summary.json` with only the published fields, in their order. */
export const publicSummary = (
  summary: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    SUMMARY_FIELDS.filter(field => field in summary).map(field => [
      field,
      summary[field],
    ]),
  );
