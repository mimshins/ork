/**
 * @file Tests for the root `vitest.config.ts`: inside an Ork run (`ORK_RUN`
 *   set) the workers are capped at half the cores, so several runs' suites
 *   share the machine; outside, Vitest's own default stays.
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

describe("vitest.config.ts", () => {
  it("caps the workers at half the cores inside a run", async () => {
    expect((await loadedWith("a1b2c3d4"))?.maxWorkers).toBe(
      Math.max(1, Math.floor(availableParallelism() / 2)),
    );
  });

  it("leaves the workers alone outside a run", async () => {
    expect((await loadedWith())?.maxWorkers).toBeUndefined();
  });
});
