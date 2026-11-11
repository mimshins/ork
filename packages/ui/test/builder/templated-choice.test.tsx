/**
 * @file Tests that a Claude node's `effort`, from the real format, shows as
 *   text when it holds a `{{item.…}}` template (from a `forEach` item), kept as
 *   typed, and a plain level stays a choice.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Field } from "../../src/builder/schema-form.tsx";
import { nodeSchemaOf } from "../../src/builder/schema-model.ts";
import { stubWindow } from "../dom.ts";

const ROOT = z
  .record(z.string(), z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../schema/workflow.schema.json",
        ),
        "utf8",
      ),
    ),
  );

const EFFORT = z
  .record(z.string(), z.unknown())
  .parse(
    z
      .object({ properties: z.object({ effort: z.unknown() }) })
      .parse(nodeSchemaOf(ROOT, "agent.worker")).properties.effort,
  );

const draw = (value: unknown) => {
  stubWindow();
  render(
    <Field
      context={{ problems: () => [], change: vi.fn<() => void>() }}
      name="effort"
      path={["nodes", "n", "effort"]}
      required={false}
      schema={EFFORT}
      value={value}
    />,
  );
};

afterEach(cleanup);

describe("a Claude node's effort", () => {
  it("is a text input holding a template as typed", () => {
    draw("{{item.effort}}");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Effort" }).value,
    ).toBe("{{item.effort}}");
  });

  it("stays a choice for a level", () => {
    draw("high");
    expect(screen.queryByRole("textbox", { name: "Effort" })).toBeNull();
  });
});
