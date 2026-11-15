/**
 * @file Records which of the repository's own files a test reads, so the tests'
 *   `ork once --on` exclude list can't go stale
 *   (`tools/vitest/read-guard-check.ts` fails the run on a read it excludes). A
 *   setup file: it wraps `node:fs`'s reading calls once per worker, keeps each
 *   path under the repository root that is outside `packages/`, `tools/`,
 *   `node_modules/` and `.git/`, and writes them to the run's read log after
 *   each test file. Reads in a child process the test starts are not seen.
 */

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKIP = ["packages", "tools", "node_modules", ".git"].map(
  folder => `${path.join(ROOT, folder)}${path.sep}`,
);
const WRAPPED = Symbol.for("ork.readGuard");

/** The paths read since the last test file ended. */
const reads = new Set<string>();

/** Records `target` when it is one of the repository's own files to watch. */
const note = (target: unknown): void => {
  const named =
    typeof target === "string"
      ? target
      : target instanceof URL && target.protocol === "file:"
        ? fileURLToPath(target)
        : undefined;
  if (named === undefined) return;
  const full = path.resolve(named);
  if (!full.startsWith(`${ROOT}${path.sep}`)) return;
  if (SKIP.some(folder => full.startsWith(folder))) return;
  reads.add(path.relative(ROOT, full));
};

/** `call` on `host`, wrapped to note its first argument. */
const watch = (host: object, call: string): void => {
  const original: unknown = Reflect.get(host, call);
  if (typeof original !== "function") return;
  Reflect.set(host, call, function (this: unknown, ...args: unknown[]) {
    note(args[0]);
    const result: unknown = Reflect.apply(original, this, args);
    return result;
  });
};

if (!Reflect.has(globalThis, WRAPPED)) {
  Reflect.set(globalThis, WRAPPED, true);
  for (const call of [
    "readFileSync",
    "readdirSync",
    "existsSync",
    "statSync",
    "lstatSync",
    "openSync",
    "readFile",
    "readdir",
    "stat",
    "lstat",
    "open",
    "createReadStream",
  ]) {
    watch(fs, call);
  }
  for (const call of [
    "readFile",
    "readdir",
    "stat",
    "lstat",
    "open",
    "access",
  ]) {
    watch(fs.promises, call);
  }
  syncBuiltinESMExports();
}

afterAll(() => {
  const log = process.env["ORK_TEST_READ_LOG"];
  if (log === undefined || reads.size === 0) return;
  fs.mkdirSync(log, { recursive: true });
  fs.appendFileSync(
    path.join(log, `reads-${String(process.pid)}.txt`),
    `${[...reads].join("\n")}\n`,
  );
  reads.clear();
});
