/**
 * @file `pnpm benchmarks:check` (part of `pnpm check`): every file in the
 *   public `benchmarks/` folder is one a benchmark may hold, its `summary.json`
 *   has only the published fields, and nothing in it holds a path, an email, a
 *   token or this machine's own names (public.ts). It keeps a hand edit from
 *   publishing what `pnpm benchmark:publish` would not.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse, rec } from "./json.ts";
import {
  allowedFile,
  findings,
  localNames,
  PUBLIC_DIR,
  SUMMARY_FIELDS,
} from "./public.ts";

const filesUnder = (dir: string, prefix = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? filesUnder(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );

const FIELDS: readonly string[] = SUMMARY_FIELDS;

/** What is wrong with the public folder at `root`; empty when nothing is. */
export const checkPublic = (
  root: string,
  names: readonly string[] = localNames(),
): string[] => {
  const dir = path.join(root, PUBLIC_DIR);
  if (!existsSync(dir)) return [];
  return filesUnder(dir).flatMap(file => {
    const body = readFileSync(path.join(dir, file), "utf8");
    const extra = file.endsWith("/summary.json")
      ? Object.keys(rec(parse(body))).filter(key => !FIELDS.includes(key))
      : [];
    const found = findings(body, names).map(what => `${file}: holds ${what}`);
    for (const key of extra) {
      found.push(`${file}: \`${key}\` is not a published field`);
    }
    if (!allowedFile(file))
      found.push(`${file}: not a file a benchmark may hold`);
    return found;
  });
};

if (import.meta.main) {
  const problems = checkPublic(process.cwd());
  if (problems.length > 0) {
    console.error(
      `${PUBLIC_DIR}/ is not safe to publish:\n${problems.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${PUBLIC_DIR}/ is safe to publish.`);
  }
}
