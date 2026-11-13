/**
 * @file The audit's two inputs. A workflow input is a plain `string`, so the
 *   format can't limit `profile` to `quick` or `standard`: `scan` checks both
 *   here, before anything else, and fails with the allowed values before any
 *   token is spent (a gap entry records the format's limit).
 */

import { PROFILE_NAMES, type ProfileName } from "./profiles.ts";

export type Scope =
  | { kind: "all"; paths: readonly string[] }
  | { kind: "paths"; paths: readonly string[] }
  | { kind: "diff"; ref: string; paths: readonly string[] };

export type Inputs = { profile: ProfileName; scope: Scope };

const SCOPE_HELP = "`all`, one or more repository paths, or `diff:<ref>`";

// A ref git accepts without being read as an option or a revision range.
const REF = /^[A-Za-z0-9_][A-Za-z0-9._/@^~-]*$/u;

const isProfile = (value: string): value is ProfileName =>
  PROFILE_NAMES.some(name => name === value);

const checkPath = (value: string): string => {
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.startsWith("~") ||
    segments.includes("..") ||
    /[\\\0:]/u.test(value)
  ) {
    throw new Error(
      `scope path "${value}" must stay inside the checkout: a relative path with no "..". Allowed: ${SCOPE_HELP}.`,
    );
  }
  return value.replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "") || ".";
};

/** `profile` and `scope` as the workflow gets them; empty means the default. */
export const checkInputs = (profile = "", scope = ""): Inputs => {
  const name = profile.trim() === "" ? "quick" : profile.trim();
  if (!isProfile(name)) {
    throw new Error(
      `profile "${name}" is not allowed. Allowed values: ${PROFILE_NAMES.join(", ")}.`,
    );
  }
  const text = scope.trim() === "" ? "all" : scope.trim();
  if (text === "all")
    return { profile: name, scope: { kind: "all", paths: ["."] } };
  if (text.startsWith("diff:")) {
    const ref = text.slice("diff:".length);
    if (!REF.test(ref)) {
      throw new Error(
        `scope "${text}" has no usable ref after "diff:". Allowed: ${SCOPE_HELP}.`,
      );
    }
    return { profile: name, scope: { kind: "diff", ref, paths: [] } };
  }
  const paths = text
    .split(/[\s,]+/u)
    .filter(item => item !== "")
    .map(item => checkPath(item));
  return { profile: name, scope: { kind: "paths", paths } };
};

/** Lists the files a `diff:<ref>` scope names; any other scope is unchanged. */
export const resolveScope = (
  scope: Scope,
  changedFiles: (ref: string) => readonly string[],
): Scope =>
  scope.kind === "diff" ? { ...scope, paths: changedFiles(scope.ref) } : scope;
