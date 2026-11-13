/**
 * @file Tests the audit's input check: `fast` is refused with the allowed
 *   values (and through the CLI, with nothing on stdout), an empty profile is
 *   `quick`, and a scope is `all`, repository paths, or `diff:<ref>`.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkInputs, resolveScope } from "../inputs.ts";

const CLI = path.resolve(import.meta.dirname, "../cli.ts");

describe("checkInputs", () => {
  it("refuses a profile it does not know, naming the allowed values", () => {
    expect(() => checkInputs("fast")).toThrow(
      /Allowed values: quick, standard/u,
    );
  });

  it("takes quick for an empty profile and all for an empty scope", () => {
    expect(checkInputs("", "")).toEqual({
      profile: "quick",
      scope: { kind: "all", paths: ["."] },
    });
  });

  it("reads paths, separated by spaces or commas", () => {
    expect(
      checkInputs("standard", "packages/core, ./tools/audit/").scope,
    ).toEqual({
      kind: "paths",
      paths: ["packages/core", "tools/audit"],
    });
  });

  it.each(["../secrets", "/etc", "~/x", "a/../b"])(
    "keeps a scope path inside the checkout: %s",
    scope => {
      expect(() => checkInputs("quick", scope)).toThrow(/inside the checkout/u);
    },
  );

  it.each(["diff:", "diff:--output=x", "diff: main"])(
    "refuses a diff scope with no usable ref: %s",
    scope => {
      expect(() => checkInputs("quick", scope)).toThrow(/diff:<ref>/u);
    },
  );

  it("lists the files of a diff scope", () => {
    const { scope } = checkInputs("quick", "diff:origin/main");
    expect(resolveScope(scope, () => ["a.ts"])).toEqual({
      kind: "diff",
      ref: "origin/main",
      paths: ["a.ts"],
    });
  });
});

const run = (profile: string) =>
  spawnSync("node", [CLI, "check-inputs"], {
    encoding: "utf8",
    env: { ...process.env, PROFILE: profile, SCOPE: "" },
  });

describe("the CLI's check-inputs", () => {
  it("fails on `fast` with the allowed values and prints no JSON", () => {
    const result = run("fast");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("quick, standard");
    expect(result.stdout).toBe("");
  });

  it("prints the inputs as JSON when they are fine", () => {
    const result = run("standard");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ profile: "standard" });
  });
});
