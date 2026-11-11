/**
 * @file Vitest configuration: where the packages' and tools' tests live. The
 *   UI's tests (`.tsx`) run in a DOM (jsdom); the rest run in Node. `HOME` is a
 *   temp folder, so no test reaches the developer's own `~/.ork/state.db`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

const HOME = mkdtempSync(path.join(tmpdir(), "ork-test-home-"));
process.once("exit", () => {
  rmSync(HOME, { recursive: true, force: true });
});

// Inside an Ork run, several suites share the machine: use half the cores.
const inRun = process.env["ORK_RUN"] !== undefined;

export default defineConfig({
  test: {
    ...(inRun
      ? { maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)) }
      : {}),
    env: { HOME },
    projects: [
      {
        test: {
          name: "node",
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
