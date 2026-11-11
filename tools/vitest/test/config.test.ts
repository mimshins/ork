/**
 * @file Tests for the root `vitest.config.ts`: the workers are capped at a
 *   third of the cores, in an Ork run (`ORK_RUN` set) or not, so a suite spends
 *   less CPU and several runs' suites share the machine.
 */

import { availableParallelism } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The `test` of the config as it loads with `ORK_RUN` set to `run`. */
const loadedWith = async (run?: string) => {
  vi.stubEnv("ORK_RUN", run);
  vi.resetModules();
  const { default: config } = await import("../../../vitest.config.ts");
  return config.test;
};

const THIRD = Math.max(1, Math.floor(availableParallelism() / 3));

describe("vitest.config.ts", () => {
  it("caps the workers at a third of the cores inside a run", async () => {
    expect((await loadedWith("a1b2c3d4"))?.maxWorkers).toBe(THIRD);
  });

  it("caps them the same outside a run", async () => {
    expect((await loadedWith())?.maxWorkers).toBe(THIRD);
  });
});
