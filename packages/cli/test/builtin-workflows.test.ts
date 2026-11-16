/**
 * @file Tests for `ork:` names in the CLI: a built-in resolves to its file in
 *   the project's run folder, loads clean as that project's workflow with its
 *   runs beside the project's own, and an unknown name is refused; `ork
 *   onboard`'s two built-ins validate on every driver.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DriverId } from "@krapht/ork-integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { explainNode } from "../src/commands/context.ts";
import { loadWorkflow } from "../src/commands/validate.ts";
import { driverDiagnostics } from "../src/run/driver-check.ts";
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

/** The names of the context files `ork context explain` lists for a node. */
const explainedFiles = (file: string, node: string, root: string): string => {
  const result = explainNode(file, node, root, path.join(base, "home"));
  return result.ok ? result.explanation.files.map(f => f.name).join(" ") : "";
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
    const message = String(errors.mock.calls.at(-1)?.[0]);
    expect(message).toContain("`ork:nope` isn't one of Ork's workflows");
    expect(message).toContain("`ork:feedback-apply`");
    expect(message).toContain("`ork:security-audit`");
    expect(process.exitCode).toBe(1);
    errors.mockRestore();
  });

  it("writes the security audit's bundle beside its workflow, and validates it", () => {
    const root = project();
    const { file } = workflowArg("ork:security-audit", root);
    expect(file).toMatch(
      /^\.ork\/runs\/\.builtin\/[0-9a-f]{12}\/security-audit\.ork\.yaml$/u,
    );
    const folder = path.join(root, path.dirname(file));
    expect(existsSync(path.join(folder, "security-audit", "cli.ts"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(folder, "security-audit", "skill", "SKILL.md")),
    ).toBe(true);
    const loaded = loadWorkflow(file, root, path.join(base, "home"), []);
    expect(loaded.report.diagnostics).toEqual([]);
    expect(loaded.workflow?.name).toBe("ork-security-audit");
    expect(refusedBuiltin(["ork:security-audit"], root)).toBe(false);
  });

  it("explains a node of the security audit, reading its bundled rule", () => {
    const root = project();
    const { file } = workflowArg("ork:security-audit", root);
    expect(explainedFiles(file, "recon", root)).toContain("read-only-bash.md");
  });
});

/**
 * The errors `ork validate --driver <driver>` gives built-in `name`. A warning
 * passes: `command-code` reports no dollars, so the dollar cap can't see its
 * sessions, and the tokens cap holds them.
 */
const validated = async (name: string, driver: DriverId) => {
  const root = project();
  const loaded = loadWorkflow(
    workflowArg(name, root).file,
    root,
    path.join(base, "home"),
    [],
  );
  const found = [
    ...loaded.report.diagnostics,
    ...(loaded.workflow === null
      ? []
      : await driverDiagnostics(loaded.workflow, { override: driver })),
  ];
  return found.filter(d => d.severity === "error");
};

const ONBOARD = ["ork:onboard-propose", "ork:onboard-write"];

describe("ork onboard's built-ins", () => {
  it.each(
    ONBOARD.flatMap(name =>
      (["claude-code", "open-code", "command-code"] as const).map(
        driver => [name, driver] as const,
      ),
    ),
  )("%s validates on %s", async (name, driver) => {
    expect(await validated(name, driver)).toEqual([]);
  });

  it("explain each node's bundled rule", () => {
    const root = project();
    const propose = workflowArg("ork:onboard-propose", root).file;
    const write = workflowArg("ork:onboard-write", root).file;
    expect(explainedFiles(propose, "propose", root)).toContain(
      "suggestions.md",
    );
    expect(explainedFiles(write, "write", root)).toContain("writing.md");
  });

  it("are refused by no name check", () => {
    expect(refusedBuiltin(ONBOARD, project())).toBe(false);
  });
});
