/**
 * @file Vitest configuration: where the packages' and tools' tests live. The
 *   UI's tests (`.tsx`) run in a DOM (jsdom); the rest run in Node. `HOME` is a
 *   temp folder, so no test reaches the developer's own `~/.ork/state.db`, and
 *   the caller's `ORK_PLAIN` and `NO_COLOR` are dropped. The Node tests' child
 *   Node processes share one compile cache, so a CLI start costs half.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

const HOME = mkdtempSync(path.join(tmpdir(), "ork-test-home-"));
// The Node tests' children share one compile cache (tools/vitest/compile-cache.ts).
process.env["ORK_TEST_COMPILE_CACHE"] = path.join(HOME, "compile-cache");

// The caller's terminal settings stay out of the tests: an `ork run --plain`
// (or NO_COLOR) around `pnpm check` would change what the CLI's tests see.
delete process.env["ORK_PLAIN"];
delete process.env["NO_COLOR"];
process.once("exit", () => {
  rmSync(HOME, { recursive: true, force: true });
});

/**
 * A test that polls (`expect.poll`) gives up after 5 s, not Vitest's 1 s: a
 * check in a run shares the machine with another run's at lower priority.
 */
const expect = { poll: { timeout: 5000 } };

// A third of the cores, in a run or not: more workers than that spend more CPU
// for the same tests (cores shared, caches cold; measured on 12 cores: 4 workers
// used about 310 CPU-s for the suite, the default 11 used about 500), and
// several runs' suites share the machine.
const workers = Math.max(1, Math.floor(availableParallelism() / 3));

export default defineConfig({
  test: {
    maxWorkers: workers,
    env: { HOME },
    projects: [
      {
        test: {
          name: "node",
          expect,
          setupFiles: ["tools/vitest/compile-cache.ts"],
          // Many tests start the CLI, git or a child process: 2.5-3.5 s in a
          // full run, past Vitest's 5 s default on a busy machine (a pre-push
          // check while a run's sessions work). A test that needs longer still
          // sets its own.
          testTimeout: 15_000,
          include: [
            "packages/*/test/**/*.test.ts",
            "tools/*/test/**/*.test.ts",
          ],
          exclude: ["packages/ui/**"],
        },
      },
      {
        test: {
          name: "ui",
          expect,
          // The Builder's tests drive a whole form: 2-3 s alone, past the 5 s
          // default when a run's check shares the machine with another's (at
          // lower priority, on half the cores).
          testTimeout: 15_000,
          include: ["packages/ui/test/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
