/**
 * @file Tests that the builder's own controls (the ones a generated control
 *   would not know enough for) are read with their problem: `aria-invalid`, and
 *   an `aria-describedby` that reaches the problem's words; with no problem,
 *   neither. Each control is a row of one table, so a new one is one more row.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { customControl } from "../../src/builder/custom-controls.tsx";
import type { FormPath } from "../../src/builder/form-parts.tsx";
import { Field } from "../../src/builder/schema-form.tsx";
import type { JsonSchema } from "../../src/builder/schema-model.ts";
import { violations } from "../axe.ts";
import { builder, described } from "./problem-harness.ts";

afterEach(() => {
  cleanup();
});

const LINES = ["First thing wrong.", "Second thing wrong."];

const LIST: JsonSchema = { type: "array", items: { type: "string" } };

type Row = {
  name: string;
  path: FormPath;
  schema?: JsonSchema;
  /** The control's accessible name. */
  label: string;
  /** The control's role; a select is a `combobox`. */
  role?: "combobox" | "textbox";
  /** The value the field holds, if the control needs one to be drawn. */
  value?: string;
  /** The control's own hint, which `aria-describedby` lists before a problem. */
  hint?: string;
  /** The node the control belongs to; default `build`. */
  node?: string;
};

/** Every custom control with a single value, by the path that picks it. */
const ROWS: readonly Row[] = [
  { name: "owner", path: ["nodes", "build", "parent"], label: "Owner" },
  {
    name: "join count",
    path: ["nodes", "build", "n"],
    label: "How many inputs to wait for",
  },
  {
    name: "notify target",
    path: ["nodes", "build", "notify", "to"],
    label: "To",
  },
  { name: "agent", path: ["nodes", "build", "agent"], label: "Agent" },
  {
    name: "skills",
    path: ["nodes", "build", "skills"],
    schema: LIST,
    label: "Add a skill",
  },
  {
    name: "gate recommended",
    path: ["nodes", "ask", "recommended"],
    node: "ask",
    label: "Recommended",
  },
  {
    name: "gate timeout answer",
    path: ["nodes", "ask", "default"],
    node: "ask",
    label: "If it times out",
  },
  {
    name: "watch.until mode",
    path: ["nodes", "build", "watch", "until"],
    label: "Look until",
  },
  {
    name: "watch.until condition",
    path: ["nodes", "build", "watch", "until"],
    value: "json.x == 1",
    role: "textbox",
    hint: "An expression, such as json.state != 'pending'. It's kept as you write it.",
    label: "Condition, to stop looking",
  },
  {
    name: "input default",
    path: ["inputs", "who", "default"],
    role: "textbox",
    label: "X",
  },
];

const draw = (row: Row, lines: readonly string[]) => {
  const { path, schema, value, node = "build" } = row;
  render(
    <main>
      <Field
        context={{
          custom: field => customControl(builder, node, field),
          problems: at => (at.join(".") === path.join(".") ? lines : []),
          change: () => {},
        }}
        name="x"
        path={path}
        required={false}
        schema={schema ?? {}}
        value={value}
      />
    </main>,
  );
};

const hintOf = (row: Row): string[] =>
  row.hint === undefined ? [] : [row.hint];

const controlOfRow = (row: Row) =>
  screen.getByRole(row.role ?? "combobox", { name: row.label });

describe("a custom control with a problem", () => {
  it.each(ROWS)("ties the $name control to its problem", async row => {
    draw(row, LINES);
    const control = controlOfRow(row);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(described(control)).toEqual([...hintOf(row), LINES.join("")]);
    expect(await violations(document.body)).toEqual([]);
  });

  it.each(ROWS)("leaves the $name control plain with none", row => {
    draw(row, []);
    const control = controlOfRow(row);
    expect(control.getAttribute("aria-invalid")).toBeNull();
    expect(described(control)).toEqual(hintOf(row));
  });
});
