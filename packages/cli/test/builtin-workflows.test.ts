/**
 * @file Tests for `ork:` names in the CLI: a built-in resolves to its file in
 *   the project's run folder, loads clean as that project's workflow with its
 *   runs beside the project's own, and an unknown name is refused.
 */

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadWorkflow } from "../src/commands/validate.ts";
import { refusedBuiltin, workflowArg } from "../src/workflows.ts";

let base = "";

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-builtin-cli-")));
  // Never the real ~/.ork: the project registry is read from HOME.
  vi.stubEnv("HOME", path.join(base, "home"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

const project = (): string => {
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
};

describe("an `ork:` workflow argument", () => {
  it("resolves to the built-in's file in the project's run folder", () => {
    const root = project();
    const target = workflowArg("ork:feedback-apply", root);
    expect(target.file).toMatch(
      /^\.ork\/runs\/\.builtin\/[0-9a-f]{12}\/feedback-apply\.ork\.yaml$/u,
    );
    expect(target.place.root).toBe(root);
    expect(target.runDir("r1")).toBe(path.join(root, ".ork", "runs", "r1"));
  });

  it("loads clean, as the project's workflow", () => {
    const root = project();
    const loaded = loadWorkflow(
      workflowArg("ork:feedback-apply", root).file,
      root,
      path.join(base, "home"),
      [],
    );
    expect(loaded.report.diagnostics).toEqual([]);
    expect(loaded.workflow?.name).toBe("ork-feedback-apply");
    expect(loaded.place.root).toBe(root);
  });

  it("is refused when it names no built-in", () => {
    const errors = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    expect(refusedBuiltin(["ork:feedback-apply", "hello"], project())).toBe(
      false,
    );
    expect(refusedBuiltin(["ork:nope"], base)).toBe(true);
    expect(String(errors.mock.calls.at(-1)?.[0])).toContain(
      "`ork:nope` isn't one of Ork's workflows",
    );
    expect(process.exitCode).toBe(1);
    errors.mockRestore();
  });
});
