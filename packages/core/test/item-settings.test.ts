/**
 * @file Tests for the compiler's checks on `model` and `effort` templates: each
 *   read checked as a prompt's (`inputs`, an upstream output, `item` only on a
 *   `forEach` node), every written item's value a model name or an effort level
 *   when only the item is read, no template in `defaults`; an item from `from:`
 *   is checked when it runs.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

/** Each diagnostic of compiling these lines, as `severity:code path`. */
const found = (lines: string[]): string[] => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow).diagnostics.map(
    d => `${d.severity}:${d.code} ${d.path.join(".")}`,
  );
};

const messages = (lines: string[]): string[] => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow).diagnostics.map(d => d.message);
};

/** A fanned reviewer with these settings and written items. */
const review = (settings: string[], items: string[]) => [
  "inputs: { level: { type: string } }",
  "nodes:",
  "  review:",
  "    type: agent.worker",
  "    prompt: Review",
  ...settings.map(line => `    ${line}`),
  "    forEach:",
  "      items:",
  ...items.map(item => `        - ${item}`),
];

const ITEMS = [
  "{ model: opus, effort: high }",
  "{ model: sonnet, effort: low }",
];

describe("model and effort from {{item}}", () => {
  it("accepts templates reading the item on a forEach node", () => {
    expect(
      found(
        review(['model: "{{item.model}}"', 'effort: "{{item.effort}}"'], ITEMS),
      ),
    ).toEqual([]);
  });

  it("accepts an empty value, which falls back to the default", () => {
    expect(
      found(review(['effort: "{{item.effort}}"'], ['{ effort: "" }'])),
    ).toEqual([]);
  });

  it.each(["model", "effort"])(
    "refuses a %s template reading the item on a node without forEach",
    field => {
      const lines = [
        "nodes:",
        `  solo: { type: agent.worker, prompt: Go, ${field}: "{{item.${field}}}" }`,
      ];
      expect(found(lines)).toEqual([
        `error:${field}.template nodes.solo.${field}`,
      ]);
      expect(messages(lines)[0]).toContain(
        "`inputs.*` or `nodes.<id>.output.*`",
      );
    },
  );

  it("refuses {{index}} off a fanned node, once", () => {
    expect(
      found([
        "nodes:",
        '  solo: { type: agent.worker, prompt: Go, effort: "{{index}}" }',
      ]),
    ).toEqual(["error:effort.template nodes.solo.effort"]);
  });

  it("checks each written item's {{index}} as an effort level", () => {
    expect(found(review(['effort: "{{index}}"'], ITEMS))).toEqual([
      "error:effort.item nodes.review.forEach.items.0",
      "error:effort.item nodes.review.forEach.items.1",
    ]);
  });

  it("refuses a written item whose model starts with a dash", () => {
    expect(
      found(review(['model: "{{item.model}}"'], ['{ model: "--yolo" }'])),
    ).toEqual(["error:model.item nodes.review.forEach.items.0"]);
  });

  it("checks the item reads of a fanned node that also reads an input", () => {
    expect(
      found(review(['model: "{{inputs.level}}-{{item.size}}"'], ITEMS)),
    ).toEqual(["error:item.field nodes.review.model"]);
    expect(
      found(review(['model: "{{inputs.level}}-{{item.model}}"'], ITEMS)),
    ).toEqual([]);
  });

  it("refuses an item field the items lack", () => {
    expect(found(review(['model: "{{item.size}}"'], ITEMS))).toEqual([
      "error:item.field nodes.review.model",
    ]);
  });

  it("refuses a written item whose effort is no level, at that item", () => {
    const lines = review(
      ['effort: "{{item.effort}}"'],
      ["{ effort: high }", "{ effort: hard }"],
    );
    expect(found(lines)).toEqual([
      "error:effort.item nodes.review.forEach.items.1",
    ]);
    expect(messages(lines)).toEqual([
      "item 1: `effort: {{item.effort}}` gave `hard`, which is not an effort level (low, medium, high, xhigh, max)",
    ]);
  });

  it("refuses a written item whose model is no model name", () => {
    expect(
      found(review(['model: "{{item.model}}"'], ["{ model: { name: opus } }"])),
    ).toEqual(["error:model.item nodes.review.forEach.items.0"]);
  });

  it("leaves an item from `from:` to be checked when it runs", () => {
    expect(
      found([
        "nodes:",
        "  plan:",
        "    type: agent.worker",
        "    prompt: Plan",
        "    output:",
        "      schema: { tasks: { list: { effort: string } } }",
        "  build:",
        "    type: agent.worker",
        "    prompt: Build",
        '    effort: "{{item.effort}}"',
        "    forEach:",
        '      from: "{{nodes.plan.output.tasks}}"',
        "      maxItems: 4",
        "edges:",
        "  - plan -> build",
      ]),
    ).toEqual([]);
  });

  it.each([
    ["model", "{{item.model}}"],
    ["model", "{{inputs.level}}"],
    ["model", "{{nodes.solo.output.summary}}"],
  ])(
    "refuses a %s template in defaults, which belong to no node: %s",
    (field, value) => {
      const line = `defaults: { ${field}: "${value}" }`;
      expect(
        found([
          "inputs: { level: { type: string } }",
          line,
          "nodes:",
          "  solo: { type: agent.worker, prompt: Go }",
        ]),
      ).toEqual([`error:${field}.template defaults.${field}`]);
    },
  );
});

/** A worker `work` with this `model:`, after a `pick` that reports `model`. */
const picked = (model: string, edge = true) => [
  "inputs: { level: { type: string } }",
  "nodes:",
  "  pick:",
  "    type: agent.worker",
  "    prompt: Pick",
  "    output: { schema: { model: string } }",
  "  work:",
  "    type: agent.worker",
  "    prompt: Work",
  `    model: "${model}"`,
  ...(edge ? ["edges:", "  - pick -> work"] : []),
];

describe("model and effort from an input or an earlier output", () => {
  it.each([
    "{{inputs.level}}",
    "{{nodes.pick.output.model}}",
    "claude-code.{{inputs.level}}",
  ])("accepts %s on a node without forEach", model => {
    expect(found(picked(model))).toEqual([]);
  });

  it("accepts an effort read from an input", () => {
    expect(
      found([
        "inputs: { level: { type: string } }",
        "nodes:",
        '  solo: { type: agent.worker, prompt: Go, effort: "{{inputs.level}}" }',
      ]),
    ).toEqual([]);
  });

  it.each([
    ["{{inputs.tier}}", "error:ref.input nodes.work.model"],
    ["{{nodes.nope.output.model}}", "error:ref.node nodes.work.model"],
    // As in a prompt: an agent's unknown field is a warning.
    ["{{nodes.pick.output.size}}", "warning:ref.field nodes.work.model"],
  ])("reports %s, which reads nothing there", (model, code) => {
    expect(found(picked(model))).toEqual([code]);
  });

  it("warns when the node read does not run first", () => {
    expect(found(picked("{{nodes.pick.output.model}}", false))).toEqual([
      "warning:template.not-upstream nodes.work.model",
    ]);
  });
});
