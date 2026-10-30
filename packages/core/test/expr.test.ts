/**
 * @file Tests for the expression language: parsing, evaluation, functions and
 *   templates.
 */

import { describe, expect, it } from "vitest";

import {
  collectPaths,
  evaluate,
  parseExpr,
  parseTemplate,
  renderTemplate,
  type Scope,
} from "../src/index.ts";

const scope: Scope = {
  inputs: { feature: "dark mode", retries: 2 },
  nodes: {
    approver: { output: { verdict: "approve" } },
    reviews: { output: { statuses: ["pass", "changes_requested"] } },
  },
  output: {
    verdict: "escalate",
    statuses: ["pass", "pass"],
    summary: "ok",
  },
};

const parseOk = (source: string) => {
  const result = parseExpr(source);
  if (!result.ok) throw new Error(result.message);
  return result.expr;
};

const parseError = (source: string) => {
  const result = parseExpr(source);
  if (result.ok) throw new Error(`expected "${source}" to be rejected`);
  return result.message;
};

const run = (source: string) => evaluate(parseOk(source), scope);

const renderOk = (source: string) => {
  const result = parseTemplate(source);
  if (!result.ok) throw new Error(result.message);
  return renderTemplate(result.parts, scope);
};

describe("evaluate", () => {
  it.each([
    ["verdict == 'escalate'", true],
    ["output.verdict != 'approve'", true],
    ["nodes.approver.output.verdict == 'approve'", true],
    ["all(statuses, 'pass')", true],
    ["any(nodes.reviews.output.statuses, 'changes_requested')", true],
    ["all(nodes.reviews.output.statuses, 'pass')", false],
    ["count(nodes.reviews.output.statuses, 'pass')", 1],
    ["len(statuses) == 2 && inputs.retries >= 2", true],
    ["!contains(summary, 'fail') || false", true],
    ["contains(statuses, 'pass')", true],
    ["missing.field == null", false],
    ["missing.field", undefined],
    ["all(missing)", false],
    ['(1 < 2) && "a" < "b"', true],
  ])("%s", (source, expected) => {
    expect(run(source)).toBe(expected);
  });

  it("reads no inherited properties", () => {
    expect(run("summary.constructor")).toBeUndefined();
    expect(run("inputs.__proto__")).toBeUndefined();
  });
});

describe("parseExpr", () => {
  it.each([
    ["verdict ==", "unexpected end of expression"],
    ["eval('x')", 'unknown function "eval"'],
    ["a.b()", "unexpected input after expression"],
    ["'open", "unterminated string"],
    ["a = 1", 'unexpected character "="'],
  ])("rejects %s", (source, message) => {
    expect(parseError(source)).toContain(message);
  });

  it("collects every path read", () => {
    expect(
      collectPaths(parseOk("any(nodes.a.output.x, 'y') && inputs.z[0]")),
    ).toEqual([
      ["nodes", "a", "output", "x"],
      ["inputs", "z", 0],
    ]);
  });
});

describe("templates", () => {
  it("renders values in text", () => {
    expect(
      renderOk("Build {{ inputs.feature }} ({{inputs.retries}}x){{nope}}"),
    ).toBe("Build dark mode (2x)");
  });

  it("renders objects as JSON", () => {
    expect(renderOk("{{statuses}}")).toBe('["pass","pass"]');
  });

  it("reports an unclosed template with its offset", () => {
    expect(parseTemplate("hi {{ inputs.x")).toEqual({
      ok: false,
      message: 'unclosed "{{"',
      offset: 3,
    });
  });
});
