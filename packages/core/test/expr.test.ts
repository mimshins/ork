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
  renderBrief,
  renderTemplate,
  resolvePath,
  runScope,
  type Scope,
  templatePath,
  templateValue,
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
    ["eval('x')", "unknown function `eval`"],
    ["a.b()", "unexpected input after expression"],
    ["'open", "unterminated string"],
    ["a = 1", "unexpected character `=`"],
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
      message: "unclosed `{{`",
      offset: 3,
    });
  });
});

/** A template rendered over `over`, the one that must parse. */
const render = (source: string, over: Scope): string => {
  const template = parseTemplate(source);
  return template.ok ? renderTemplate(template.parts, over) : "(not parsed)";
};

describe("an item of a fanned node", () => {
  const item = { of: "build", index: 2, value: { title: "docs", n: 1 } };
  const itemScope = runScope({}, { plan: { tasks: ["a", "b"] } }, "r1", item);
  it("reads the item, its fields and its index", () => {
    expect(render("{{item.title}} #{{index}}", itemScope)).toBe("docs #2");
    expect(evaluate(parseOk("index == 2"), itemScope)).toBe(true);
    expect(evaluate(parseOk("item.n == 1"), itemScope)).toBe(true);
  });

  it("renders an object item as JSON, and a string item as itself", () => {
    expect(render("do {{item}}", itemScope)).toBe('do {"title":"docs","n":1}');
    const text = runScope({}, {}, "r1", { of: "b", index: 0, value: "api" });
    expect(render("pnpm --filter {{item}} lint", text)).toBe(
      "pnpm --filter api lint",
    );
  });

  it("reads index 0 and a falsy item", () => {
    const first = runScope({}, {}, "r1", { of: "b", index: 0, value: 0 });
    expect(render("{{index}}:{{item}}", first)).toBe("0:0");
  });

  it("leaves a bare item or index in a `when:` reading the output", () => {
    const output = { ...scope, output: { item: "from output", index: 7 } };
    expect(evaluate(parseOk("item"), output)).toBe("from output");
    expect(evaluate(parseOk("index"), output)).toBe(7);
  });

  it("reads nothing that is not the item's own", () => {
    expect(resolvePath(["item", "constructor"], itemScope)).toBeUndefined();
    expect(resolvePath(["item", "__proto__"], itemScope)).toBeUndefined();
  });

  it("reaches a prompt", () => {
    expect(
      renderBrief("Do {{item.title}}", {}, {}, undefined, item),
    ).toMatchObject({ ok: true, text: "Do docs" });
  });
});

describe("a template that is one path", () => {
  const listScope = runScope({}, { plan: { tasks: ["a", "b"] } });

  it("gives the value itself, not text", () => {
    expect(templateValue("{{nodes.plan.output.tasks}}", listScope)).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(templateValue("{{ nodes.plan.output.none }}", listScope)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([
    "a {{nodes.plan.output.tasks}}",
    "{{nodes.plan.output.tasks}} ",
    "{{nodes.a.output.x}}{{nodes.b.output.y}}",
    "{{len(nodes.plan.output.tasks)}}",
    "{{true}}",
    "plain",
    "",
    "{{nodes.plan",
  ])("refuses %j", source => {
    expect(templatePath(source)).toBeNull();
    expect(templateValue(source, listScope).ok).toBe(false);
  });
});
