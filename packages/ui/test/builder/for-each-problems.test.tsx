/**
 * @file Tests that the For each controls ("List from", "Most items") and the
 *   declare-a-list form are read with their problem: `aria-invalid`, and an
 *   `aria-describedby` that reaches the problem's words after the hint; with no
 *   problem, neither.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DeclareList } from "../../src/builder/declare-field.tsx";
import { forEachControl } from "../../src/builder/for-each-control.tsx";
import type { FormPath } from "../../src/builder/form-parts.tsx";
import { Field } from "../../src/builder/schema-form.tsx";
import { builder, described } from "./problem-harness.ts";

afterEach(() => {
  cleanup();
});

const LINES = ["First thing wrong.", "Second thing wrong."];

const FOR_EACH: FormPath = ["nodes", "build", "forEach"];

const drawForEach = (lines: readonly string[]) => {
  render(
    <main>
      <Field
        context={{
          custom: field => forEachControl(builder, "build", field),
          problems: at =>
            at.join(".") === [...FOR_EACH, "from"].join(".") ? lines : [],
          change: () => {},
        }}
        name="forEach"
        path={FOR_EACH}
        required={false}
        schema={{}}
        value={{ from: "{{nodes.plan.output.tasks}}", maxItems: 4 }}
      />
    </main>,
  );
};

describe("the For each controls", () => {
  it("ties List from to its problem", () => {
    drawForEach(LINES);
    const control = screen.getByRole("combobox", { name: "List from" });
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(described(control)).toEqual([LINES.join("")]);
  });

  it("leaves List from plain with no problem", () => {
    drawForEach([]);
    const control = screen.getByRole("combobox", { name: "List from" });
    expect(control.getAttribute("aria-invalid")).toBeNull();
    expect(control.getAttribute("aria-describedby")).toBeNull();
  });

  it("ties Most items to its hint, then its problem, once it is refused", async () => {
    drawForEach([]);
    const control = screen.getByRole("spinbutton", { name: /^Most items/u });
    expect(control.getAttribute("aria-invalid")).toBeNull();
    expect(described(control)).toHaveLength(1);
    await userEvent.clear(control);
    await userEvent.type(control, "0");
    await userEvent.tab();
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const [hint, problem] = described(control);
    expect(hint).toContain("A longer list asks");
    expect(problem).toBe("Most items needs a whole number above 0.");
  });
});

const openDeclare = async () => {
  render(
    <main>
      <DeclareList
        holders={[{ id: "plan", fields: ["tasks"] }]}
        onDeclare={() => {}}
        to="build"
      />
    </main>,
  );
  await userEvent.click(screen.getByRole("button", { name: /Add a list/u }));
};

describe("the declare-a-list form", () => {
  it("ties the name to its problem, and the item fields to theirs", async () => {
    await openDeclare();
    const name = screen.getByRole("textbox", { name: "New list" });
    const items = screen.getByRole("textbox", { name: "Item fields" });
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(items.getAttribute("aria-invalid")).toBeNull();
    await userEvent.type(name, "tasks");
    await userEvent.type(items, "a:nonsense");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(described(name).at(-1)).toContain("is already a field of");
    expect(items.getAttribute("aria-invalid")).toBe("true");
    const [, problem] = described(items);
    expect(problem).toContain("nonsense");
  });
});
