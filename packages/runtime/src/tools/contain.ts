/**
 * @file Where the `extract` tool may read (RFC-023): a requested path resolved
 *   with its symlinks followed must stay inside the session's folder and out of
 *   Ork's private session folder (`secretRoot()`), and a file is refused when
 *   it matches the built-in deny list, a `Read(...)` rule of the session's
 *   `tools.deny`, or a `Read(...)` entry of the project's
 *   `.claude/settings.json` / `settings.local.json` `permissions.deny`. A
 *   settings file that exists but cannot be read refuses every path (fail
 *   closed). User-level and managed settings are not read.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { secretRoot } from "../secret-file.ts";

/** A path the session asked for, refused; the message names the path only. */
export class Refused extends Error {
  /** The path asked for caused it; not so when the project's settings did. */
  byArguments = true;
}

export type Inside = {
  /** The real path, symlinks followed. */
  real: string;
  /** Relative to the real session folder, `/`-separated; `.` for the folder. */
  rel: string;
  /** The path as asked, relative to the session folder, `/`-separated. */
  asked: string;
};

const posix = (value: string): string => value.split(path.sep).join("/");

const within = (root: string, target: string): string | undefined => {
  const rel = path.relative(root, target);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
    ? undefined
    : posix(rel) || ".";
};

/**
 * The real path of `target`, or of its nearest existing folder plus the rest.
 * The native call gives the name's case on disk, so `.ENV` on a
 * case-insensitive disk resolves to `.env`, which the deny list matches.
 */
const realOf = (target: string): string => {
  const rest: string[] = [];
  let at = target;
  for (;;) {
    try {
      return path.join(realpathSync.native(at), ...rest);
    } catch {
      const parent = path.dirname(at);
      if (parent === at) return target;
      rest.unshift(path.basename(at));
      at = parent;
    }
  }
};

/**
 * `requested` (relative to `cwd`, or absolute) resolved inside `cwd`. Throws
 * `Refused` for a path outside it, under Ork's private session folder, or one
 * starting with `:` (git's pathspec magic).
 */
export const resolveInside = (cwd: string, requested: string): Inside => {
  const refuse = (why: string): never => {
    throw new Refused(`refused: ${requested} (${why})`);
  };
  if (requested.startsWith(":")) refuse("a path can't start with `:`");
  const root = realOf(path.resolve(cwd));
  const lexical = path.resolve(cwd, requested);
  const asked = within(path.resolve(cwd), lexical);
  const real = realOf(lexical);
  const rel = within(root, real);
  if (asked === undefined || rel === undefined) {
    throw new Refused(
      `refused: ${requested} (outside the folder): extract reads only inside your folder; give a path relative to it`,
    );
  }
  if (within(realOf(secretRoot()), real) !== undefined) {
    refuse("Ork's private session folder");
  }
  return { real, rel: rel ?? ".", asked: asked ?? "." };
};

/** Whether a path relative to the session's folder is denied. */
export type Denied = (rel: string) => boolean;

/**
 * `requested` resolved inside `cwd` (`resolveInside`); throws `Refused` when it
 * is denied as asked or as resolved (a symlink to a denied file).
 */
export const readable = (
  cwd: string,
  requested: string,
  denied: Denied,
): Inside => {
  const where = resolveInside(cwd, requested);
  if (denied(where.rel) || denied(where.asked)) {
    throw new Refused(`refused: ${requested}`);
  }
  return where;
};

/** Files no session reads through `extract`, matched at any depth. */
const BUILT_IN = [
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/.npmrc",
  "**/.git",
];

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];

/** The part of a Claude Code settings file `extract` reads; the rest passes. */
const SettingsSchema = z.object({
  permissions: z.object({ deny: z.array(z.string()).optional() }).optional(),
});

/**
 * The pattern of each `Read` rule in `rules` (Claude Code's syntax): bare
 * `Read` denies every file, so it is `**`.
 */
export const readPatterns = (rules: readonly string[]): string[] =>
  rules.flatMap(rule => {
    const match = /^Read(?:\((.*)\))?$/su.exec(rule.trim());
    if (match === null) return [];
    // `Read()` names no path: deny every file, as bare `Read` does.
    return [match[1] === undefined || match[1] === "" ? "**" : match[1]];
  });

const settingsPatterns = (cwd: string): string[] =>
  SETTINGS.flatMap(name => {
    const file = path.join(cwd, name);
    if (!existsSync(file)) return [];
    const fail = (why: string): never => {
      throw Object.assign(
        new Refused(
          `refused: every path, because ${name} ${why}; fix it to use extract`,
        ),
        { byArguments: false },
      );
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return fail("can't be parsed");
    }
    const settings = SettingsSchema.safeParse(parsed);
    return settings.success
      ? readPatterns(settings.data.permissions?.deny ?? [])
      : fail("has a `permissions.deny` that is not a list of rules");
  });

/** A rule as a glob, matched against absolute paths or paths from `cwd`. */
type Glob = { glob: string; absolute: boolean };

/**
 * A rule's path pattern, gitignore-style: `//x` is absolute, `~/x` under the
 * home folder (both matched against the file's absolute path), `/x` and `./x`
 * from `cwd`, a name with no `/` matches at any depth, and one ending in `/`
 * matches the folder. A pattern that names no path denies everything.
 */
const relative = (glob: string): Glob => ({
  glob: glob === "" ? "**" : glob,
  absolute: false,
});

const globOf = (pattern: string): Glob => {
  const trimmed = pattern.replace(/\/+$/u, "");
  if (trimmed.startsWith("//")) {
    return { glob: trimmed.slice(1), absolute: true };
  }
  if (trimmed.startsWith("~/")) {
    return {
      glob: posix(path.join(homedir(), trimmed.slice(2))),
      absolute: true,
    };
  }
  if (trimmed.startsWith("/")) return relative(trimmed.slice(1));
  if (trimmed.startsWith("./")) return relative(trimmed.slice(2));
  if (trimmed === "") return relative("");
  return relative(trimmed.includes("/") ? trimmed : `**/${trimmed}`);
};

/**
 * `path.matchesGlob` skips dot names for `*` and `**`; gitignore does not. Each
 * segment of both sides gets a `_` in front (a `**` stays), so none starts with
 * a dot. shortcut: a `/` inside a `{a/b,c}` group splits wrongly; upgrade to a
 * real gitignore matcher if rules use it.
 */
const undot = (value: string): string =>
  value
    .split("/")
    .map(segment => (segment === "**" ? segment : `_${segment}`))
    .join("/");

/** `rel` and each folder above it, so a rule on a folder covers its files. */
const selfAndParents = (rel: string): string[] => {
  const segments = rel.split("/");
  return segments
    .map((_, index) => segments.slice(0, index + 1).join("/"))
    .filter(candidate => candidate !== "");
};

/** Never fails open: a glob Node can't match with denies. */
const matches = (candidate: string, glob: string): boolean => {
  try {
    return path.matchesGlob(undot(candidate), glob);
  } catch {
    return true;
  }
};

/**
 * Whether a session may read a path in `cwd`, given the `Read(...)` patterns of
 * its `tools.deny`. Reads the project's settings once; throws `Refused` when
 * one of them can't be parsed. The check takes a path relative to `cwd`; an
 * absolute rule is matched against the path from the folder as given and from
 * its real path, and a path under Ork's private session folder is denied.
 */
export const deniedRead = (
  cwd: string,
  patterns: readonly string[] = [],
): Denied => {
  const globs = [...BUILT_IN, ...patterns, ...settingsPatterns(cwd)]
    .map(pattern => globOf(pattern))
    .map(({ glob, absolute }) => ({ glob: undot(glob), absolute }));
  const roots = [...new Set([path.resolve(cwd), realOf(path.resolve(cwd))])];
  const secret = realOf(secretRoot());
  return rel => {
    if (rel === "." || rel === "") return false;
    const relatives = selfAndParents(posix(rel));
    const absolutes = roots.map(root => path.join(root, rel));
    if (absolutes.some(file => within(secret, file) !== undefined)) return true;
    const absoluteCandidates = absolutes.flatMap(file =>
      selfAndParents(posix(file)),
    );
    return globs.some(({ glob, absolute }) =>
      (absolute ? absoluteCandidates : relatives).some(candidate =>
        matches(candidate, glob),
      ),
    );
  };
};
