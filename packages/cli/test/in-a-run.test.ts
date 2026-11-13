/**
 * @file The commands that refuse in a run refuse only in the stores that run
 *   guards (ADR-047): no marker allows, a marker with the store refuses, a
 *   marker without it allows, and an old marker that lists none refuses.
 */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GUARDED_STORES_ENV } from "@krapht/ork-nodes";
import { afterEach, describe, expect, it } from "vitest";

import {
  acceptRefusal,
  attachRefusal,
  chatRefusal,
  continueRefusal,
  decideRefusal,
  mayShowSignIn,
} from "../src/commands/in-a-run.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

/** A store file under a fresh folder, and its real path. */
const aStore = (): { store: string; real: string } => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-in-a-run-")));
  dirs.push(dir);
  mkdirSync(path.join(dir, ".ork"));
  const store = path.join(dir, ".ork", "state.db");
  writeFileSync(store, "");
  return { store, real: store };
};

const listing = (...stores: string[]) => ({
  [GUARDED_STORES_ENV]: JSON.stringify(stores),
});

const refusals = (env: NodeJS.ProcessEnv, store: string) => [
  acceptRefusal(env, store),
  attachRefusal(env, store),
  chatRefusal(env, store),
  continueRefusal(env, store),
  decideRefusal(env, store),
];

describe("where a run's marker guards", () => {
  it("allows everything without a marker", () => {
    const { store } = aStore();
    const env = { PATH: "/bin" };
    expect(refusals(env, store).every(why => why === null)).toBe(true);
    expect(mayShowSignIn(env, store)).toBe(true);
  });

  it.each(["ORK_RUN", "ORK_SESSION"])(
    "refuses in a listed store under %s",
    marker => {
      const { store, real } = aStore();
      const env = { [marker]: "1", ...listing(real) };
      expect(
        refusals(env, store).every(why => why?.includes(marker) === true),
      ).toBe(true);
      expect(mayShowSignIn(env, store)).toBe(false);
    },
  );

  it("allows in a store the marker does not list", () => {
    const { store } = aStore();
    const { real: other } = aStore();
    const env = { ORK_SESSION: "1", ...listing(other) };
    expect(refusals(env, store).every(why => why === null)).toBe(true);
    expect(mayShowSignIn(env, store)).toBe(true);
  });

  it("refuses everywhere under an old marker that lists none", () => {
    const { store } = aStore();
    const env = { ORK_SESSION: "1" };
    expect(refusals(env, store).every(why => why !== null)).toBe(true);
    expect(mayShowSignIn(env, store)).toBe(false);
  });

  it("refuses a store reached through a symlink", () => {
    const { store, real } = aStore();
    const link = `${path.dirname(path.dirname(store))}-link`;
    symlinkSync(path.dirname(path.dirname(store)), link);
    dirs.push(link);
    const env = { ORK_RUN: "r1", ...listing(real) };
    expect(decideRefusal(env, path.join(link, ".ork", "state.db"))).toContain(
      "ORK_RUN",
    );
  });
});
