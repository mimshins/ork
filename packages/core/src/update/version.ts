/**
 * @file Version numbers for the update check (ADR-038): parses `x.y.z` with an
 *   optional pre-release, and says whether one version is newer than another by
 *   semver precedence. Build metadata is ignored.
 */

type Version = { core: readonly number[]; pre: readonly string[] };

const VERSION =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

/** `1.2.3`, `v1.2.3-beta.1` and the like; `null` for anything else. */
export const parseVersion = (text: string): Version | null => {
  const match = VERSION.exec(text.trim());
  if (match === null) return null;
  const [, major = "0", minor = "0", patch = "0", pre] = match;
  return {
    core: [Number(major), Number(minor), Number(patch)],
    pre: pre === undefined ? [] : pre.split("."),
  };
};

const NUMERIC = /^\d+$/u;

/** One pre-release identifier against another: numbers sort below words. */
const compareIdentifier = (a: string, b: string): number => {
  const an = NUMERIC.test(a);
  const bn = NUMERIC.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : Number(a > b);
};

const comparePre = (a: readonly string[], b: readonly string[]): number => {
  // A release sorts above any of its pre-releases.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const order = compareIdentifier(a[i] ?? "", b[i] ?? "");
    if (order !== 0) return order;
  }
  return a.length - b.length;
};

/** Semver precedence: negative when `a` is older, 0 when equal. */
export const compareVersions = (a: Version, b: Version): number => {
  for (let i = 0; i < 3; i += 1) {
    const order = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (order !== 0) return order;
  }
  return comparePre(a.pre, b.pre);
};

/** Whether `candidate` is newer than `current`; false when either is invalid. */
export const isNewer = (candidate: string, current: string): boolean => {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return a !== null && b !== null && compareVersions(a, b) > 0;
};
