/**
 * @file Tests for the `sessions.freshOver` rule: a positive integer or `never`
 *   loads in a project file and in a workflow's `rules:`; `0`, a negative
 *   number, a fraction and any other word are refused, with the line of the
 *   value in the file.
 */

import { describe, expect, it } from "vitest";

import { parseProject, parseWorkflow } from "../src/index.ts";

const project = (value: string) =>
  parseProject(`schemaVersion: 1\nsessions:\n  freshOver: ${value}\n`);

const workflow = (value: string) =>
  parseWorkflow(
    `schemaVersion: 1\nname: x\nrules:\n  sessions:\n    freshOver: ${value}\nnodes:\n  a:\n    type: agent.worker\n    prompt: hi\n`,
  );

const lineOf = (result: ReturnType<typeof project | typeof workflow>) =>
  result.ok ? undefined : result.diagnostics[0]?.line;

describe("sessions.freshOver", () => {
  it.each(["100000", "1", "never"])("takes %s", value => {
    expect(project(value).ok).toBe(true);
    expect(workflow(value).ok).toBe(true);
  });

  it("is optional", () => {
    expect(parseProject("schemaVersion: 1\nsessions: {}\n").ok).toBe(true);
  });

  it.each(["0", "-5", "1.5", "soon"])("refuses %s, at its line", value => {
    expect(project(value).ok).toBe(false);
    expect(lineOf(project(value))).toBe(3);
    expect(workflow(value).ok).toBe(false);
    expect(lineOf(workflow(value))).toBe(5);
  });
});
