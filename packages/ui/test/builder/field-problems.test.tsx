/**
 * @file Tests that a generated field's problem is read with its control: the
 *   control is `aria-invalid`, and its `aria-describedby` reaches the words,
 *   after its hint; a field with no problem has neither.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FieldProps } from "../../src/builder/form-parts.tsx";
import { Field } from "../../src/builder/schema-form.tsx";
import type { JsonSchema } from "../../src/builder/schema-model.ts";
import { violations } from "../axe.ts";

afterEach(() => {
  cleanup();
});

const LINES = ["Needs a value.", "Not b."];

const SCHEMAS: Record<string, JsonSchema> = {
  text: { type: "string", description: "Say it." },
  number: { type: "number", description: "How many." },
  choice: { enum: ["a", "b"], description: "Pick one." },
  free: { description: "Anything." },
};

const ROLES: Record<string, string> = {
  text: "textbox",
  number: "spinbutton",
  choice: "combobox",
  free: "textbox",
};

const draw = (kind: string, lines: readonly string[]) => {
  const field: FieldProps = {
    name: kind,
    path: ["x"],
    schema: SCHEMAS[kind] ?? {},
    value: undefined,
    required: false,
    context: { problems: () => lines, change: () => {} },
  };
  render(
    <main>
      <Field {...field} />
    </main>,
  );
  return screen.getByRole(ROLES[kind] ?? "textbox");
};

/** The elements each id in `aria-describedby` reaches, in order. */
const reached = (control: HTMLElement): (Element | null)[] =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map(id => document.querySelector(`[id="${id}"]`));

/** The words each id in `aria-describedby` reaches, in order. */
const described = (control: HTMLElement): string[] =>
  reached(control).map(element => element?.textContent ?? "");

describe("a generated field with a problem", () => {
  it.each(Object.keys(SCHEMAS))(
    "ties its %s control to its hint, then its problem",
    kind => {
      const control = draw(kind, LINES);
      expect(control.getAttribute("aria-invalid")).toBe("true");
      const [hint, problem] = described(control);
      expect(hint).toBe(SCHEMAS[kind]?.["description"]);
      expect(problem).toBe(LINES.join(""));
    },
  );

  it("keeps the icon out of what is read, and passes axe", async () => {
    const control = draw("text", LINES);
    const icon = reached(control).at(1)?.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(await violations(document.body)).toEqual([]);
  });
});

describe("a generated field with no problem", () => {
  it.each(Object.keys(SCHEMAS))(
    "leaves its %s control with its hint alone",
    kind => {
      const control = draw(kind, []);
      expect(control.getAttribute("aria-invalid")).toBeNull();
      expect(described(control)).toEqual([SCHEMAS[kind]?.["description"]]);
    },
  );
});
