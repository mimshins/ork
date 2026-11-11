/**
 * @file Tests for the compiler's checks on `model` and `effort` templates: only
 *   on a `forEach` node, reading only `item`, and every written item's value a
 *   model name or an effort level; an item from `from:` is checked when it
 *   runs.
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
    "refuses a %s template on a node without forEach",
    field => {
      expect(
        found([
          "nodes:",
          `  solo: { type: agent.worker, prompt: Go, ${field}: "{{item.${field}}}" }`,
        ]),
      ).toEqual([`error:${field}.template nodes.solo.${field}`]);
    },
  );

  it.each([
    ['model: "{{inputs.level}}"', "error:model.template nodes.review.model"],
    ['effort: "{{index}}"', "error:effort.template nodes.review.effort"],
    [
      'model: "{{nodes.other.output.summary}}"',
      "error:model.template nodes.review.model",
    ],
  ])("refuses %s, which reads something but the item", (setting, code) => {
    expect(found(review([setting], ITEMS))).toContain(code);
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

  it("refuses a template in defaults, which belong to no item", () => {
    expect(
      found([
        'defaults: { model: "{{item.model}}" }',
        "nodes:",
        "  solo: { type: agent.worker, prompt: Go }",
      ]),
    ).toEqual(["error:model.template defaults.model"]);
  });
});
