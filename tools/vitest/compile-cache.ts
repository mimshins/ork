/**
 * @file A setup file for the Node tests: a child the test starts with this Node
 *   (`process.execPath`) gets `NODE_COMPILE_CACHE`, so the ~400 CLI starts in a
 *   full run compile each module once, not each time. The folder
 *   (`ORK_TEST_COMPILE_CACHE`) is set by `vitest.config.ts`, inside the temp
 *   `HOME` it removes at exit. Nothing else about the child changes.
 */

import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

type Options = { env?: NodeJS.ProcessEnv | undefined };

const isOptions = (value: unknown): value is Options =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `args` of a `child_process` call, with the cache set when it starts Node. */
const cached = (cache: string, args: unknown[]): unknown[] => {
  if (args[0] !== process.execPath && args[0] !== "node") return args;
  const next = [...args];
  const at = next.findIndex((arg, index) => index > 0 && isOptions(arg));
  const given = at > 0 && isOptions(next[at]) ? next[at] : {};
  const options = {
    ...given,
    env: {
      ...(given.env ?? process.env),
      NODE_COMPILE_CACHE: cache,
    },
  };
  if (at > 0) next[at] = options;
  else next.splice(Array.isArray(next[1]) ? 2 : 1, 0, options);
  return next;
};

const cache = process.env["ORK_TEST_COMPILE_CACHE"];

if (cache !== undefined) {
  for (const name of [
    "spawn",
    "spawnSync",
    "execFile",
    "execFileSync",
  ] as const) {
    const original = childProcess[name];
    const wrapped = (...args: unknown[]): unknown =>
      Reflect.apply(original, childProcess, cached(cache, args));
    // `execFile` carries its `util.promisify` form; the copy keeps it.
    Object.defineProperties(
      wrapped,
      Object.getOwnPropertyDescriptors(original),
    );
    Object.defineProperty(childProcess, name, { value: wrapped });
  }
  syncBuiltinESMExports();
}
