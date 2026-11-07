/**
 * @file Moves npm's `latest` dist-tag to a just-published pre-release. In pre
 *   mode Changesets tags only the channel (`alpha`, `beta` or `rc`), yet every
 *   pre-release is what a plain `npm install -g @krapht/ork` should get. Runs
 *   from `pnpm run release`, after `changeset publish`, with the publish job's
 *   own npm login (`NODE_AUTH_TOKEN`). It never moves `latest` to a canary or a
 *   plain release (Changesets tags that one itself), never to a version npm
 *   doesn't have, and does nothing when `latest` is already there. Usage: `node
 *   tools/release/latest-tag.ts [--dry-run]`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(import.meta.dirname, "../..");

export const PACKAGE = "@krapht/ork";

export const PACKAGE_JSON = path.join(ROOT, "packages", "cli", "package.json");

/** The pre-release channels whose versions also become `latest`. */
export const CHANNELS = ["alpha", "beta", "rc"] as const;

const CHANNEL_WORDS = new Intl.ListFormat("en", { type: "disjunction" }).format(
  CHANNELS,
);

export type NpmResult = { ok: boolean; stdout: string };

/** Runs `npm` with `args`; never throws. */
export type Npm = (args: readonly string[]) => NpmResult;

export type LatestOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "would-move" | "moved"; version: string; from?: string }
  | { kind: "failed"; reason: string };

/** The channel of `version` (`1.0.0-alpha.2` is `alpha`), if it has one. */
export const channelOf = (
  version: string,
): (typeof CHANNELS)[number] | undefined => {
  const pre = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)(?:[.+]|$)/u.exec(version)?.[1];
  return CHANNELS.find(channel => channel === pre);
};

/** `npm dist-tag ls`'s `tag: version` lines, by tag. */
export const parseDistTags = (stdout: string): Record<string, string> =>
  Object.fromEntries(
    stdout.split("\n").flatMap(line => {
      const match = /^([^:\s]+):\s*(\S+)\s*$/u.exec(line);
      return match?.[1] === undefined || match[2] === undefined
        ? []
        : [[match[1], match[2]] as const];
    }),
  );

export type MoveOptions = {
  npm: Npm;
  /** Say what it would do, and do nothing. */
  dryRun?: boolean;
  /** How often to ask npm for the version, as a new one takes a moment. */
  attempts?: number;
  /** Waits between attempts. */
  wait?: () => Promise<void>;
};

const published = async (
  version: string,
  { npm, attempts = 6, wait = () => Promise.resolve() }: MoveOptions,
): Promise<boolean> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const view = npm(["view", `${PACKAGE}@${version}`, "version"]);
    if (view.ok && view.stdout.trim() === version) return true;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, by design
    if (attempt < attempts) await wait();
  }
  return false;
};

/** Points `latest` at `version` when it is a channel's pre-release on npm. */
export const moveLatest = async (
  version: string,
  options: MoveOptions,
): Promise<LatestOutcome> => {
  if (channelOf(version) === undefined) {
    return {
      kind: "skipped",
      reason: `${version} is not an ${CHANNEL_WORDS} pre-release; latest stays as Changesets left it`,
    };
  }
  if (!(await published(version, options))) {
    return {
      kind: "skipped",
      reason: `npm doesn't have ${PACKAGE}@${version}`,
    };
  }
  const { npm } = options;
  const from = parseDistTags(npm(["dist-tag", "ls", PACKAGE]).stdout)["latest"];
  if (from === version) {
    return { kind: "skipped", reason: `latest is already ${version}` };
  }
  const moving = { version, ...(from === undefined ? {} : { from }) };
  if (options.dryRun === true) return { kind: "would-move", ...moving };
  const added = npm(["dist-tag", "add", `${PACKAGE}@${version}`, "latest"]);
  return added.ok
    ? { kind: "moved", ...moving }
    : { kind: "failed", reason: `npm dist-tag add failed for ${version}` };
};

/** What `moveLatest` did, in one line. */
export const outcomeLine = (outcome: LatestOutcome): string =>
  outcome.kind === "skipped" || outcome.kind === "failed"
    ? `latest unchanged: ${outcome.reason}.`
    : `${outcome.kind === "moved" ? "Moved" : "Would move"} latest to ${outcome.version} (from ${outcome.from ?? "none"}).`;

const realNpm: Npm = args => {
  const result = spawnSync("npm", args, { encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
};

const main = async (): Promise<void> => {
  const manifest: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
      ? manifest.version
      : "";
  const outcome = await moveLatest(version, {
    npm: realNpm,
    dryRun: process.argv.includes("--dry-run"),
    wait: () => sleep(10_000),
  });
  const line = `${outcomeLine(outcome)}\n`;
  if (outcome.kind === "failed") {
    process.stderr.write(line);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(line);
};

if (import.meta.main) await main();
