/**
 * @file Tests for the issues step of `ork init`: the workflow it writes is the
 *   `issues` example and checks with no finding, it never overwrites a file,
 *   `--no-issues` writes nothing, and with no terminal and no flag it only says
 *   how to add it.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { compileWorkflow } from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DriverChecks } from "../src/index.ts";
import {
  ISSUES_FILE,
  issuesStep,
  writeIssuesWorkflow,
} from "../src/project/issues-step.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const project = (): string => mkdtempSync(path.join(tmpdir(), "ork-issues-"));

const written = (root: string): string =>
  readFileSync(path.join(root, ISSUES_FILE), "utf8");

/** What checking a workflow's text finds: nothing for a clean one. */
const findings = (text: string): unknown[] => {
  const parsed = parseWorkflow(text);
  return parsed.ok
    ? compileWorkflow(parsed.workflow).diagnostics
    : parsed.diagnostics;
};

/** What `issuesStep` printed, without colour. */
const printed = async (
  root: string,
  issues?: boolean,
  checks: DriverChecks = readyOnly("claude-code"),
): Promise<string> => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await issuesStep(root, { issues }, checks);
  const text = out.mock.calls.map(call => String(call[0])).join("");
  out.mockRestore();
  return text;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ork init's issues workflow", () => {
  it("is the example, and checks with no finding", () => {
    const root = project();
    expect(writeIssuesWorkflow(root)).toBe(true);
    const example = readFileSync(
      new URL("../../../examples/issues.ork.yaml", import.meta.url),
      "utf8",
    );
    expect(written(root)).toBe(example);
    expect(findings(written(root))).toEqual([]);
  });

  it("never overwrites a file", () => {
    const root = project();
    mkdirSync(path.join(root, ".ork", "workflows"), { recursive: true });
    writeFileSync(path.join(root, ISSUES_FILE), "mine\n");
    expect(writeIssuesWorkflow(root)).toBe(false);
    expect(written(root)).toBe("mine\n");
  });

  it("is written with --issues and not with --no-issues", async () => {
    const asked = project();
    expect(await printed(asked, true)).toContain(ISSUES_FILE);
    expect(written(asked)).toContain("name: issues");
    const refused = project();
    expect(await printed(refused, false)).toBe("");
    expect(() => written(refused)).toThrow("ENOENT");
  });

  it("names the driver it runs on, and that it is ready", async () => {
    const text = await printed(project(), true);
    expect(text).toContain(
      "issues runs on claude-code (its model, claude-code.sonnet): claude-code is ready",
    );
  });

  it("says how to get the driver ready when it is not", async () => {
    const text = await printed(project(), true, readyOnly("open-code"));
    expect(text).toContain(
      "issues runs on claude-code (its model, claude-code.sonnet): not ready: Get the claude-code driver ready.",
    );
  });

  it("says nothing of the driver for a file that is already there", async () => {
    const root = project();
    mkdirSync(path.join(root, ".ork", "workflows"), { recursive: true });
    writeFileSync(path.join(root, ISSUES_FILE), "mine\n");
    const text = await printed(root, true);
    expect(text).not.toContain("issues runs on");
  });

  it("only says how to add it when there is no terminal and no flag", async () => {
    const root = project();
    expect(await printed(root)).toContain("ork init --issues");
    expect(() => written(root)).toThrow("ENOENT");
  });
});
