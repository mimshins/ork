/**
 * @file Tests for what the Run workflow form means: its starting values, why it
 *   cannot start, what it sends, and its CLI twin.
 */

import { describe, expect, it } from "vitest";

import {
  blockedBy,
  commandOf,
  initialValues,
  inputsToSend,
  NO_FLAGS,
} from "../../src/panels/run-form.ts";
import { workflowNamed } from "./harness.tsx";

const WITH_INPUTS = workflowNamed("build", {
  feature: { required: true },
  retries: { type: "number", default: 2 },
  fast: { type: "boolean" },
});

describe("the Run workflow form", () => {
  it("starts each input at its default", () => {
    expect(initialValues(WITH_INPUTS.inputs)).toEqual({
      feature: "",
      retries: "2",
      fast: "false",
    });
  });

  it("says why it cannot start, the first thing first", () => {
    const values = initialValues(WITH_INPUTS.inputs);
    expect(blockedBy(null, null, {})).toBe("Pick a project.");
    expect(blockedBy("p", null, {})).toBe("Pick a workflow.");
    expect(blockedBy("p", WITH_INPUTS, values)).toBe("Fill in feature.");
    expect(
      blockedBy("p", WITH_INPUTS, { ...values, feature: "x", retries: "two" }),
    ).toBe("retries must be a number.");
    expect(blockedBy("p", WITH_INPUTS, { ...values, feature: "x" })).toBeNull();
  });

  it("will not start a workflow that does not parse, and says why", () => {
    const broken = { ...workflowNamed("bad"), error: "line 3: no nodes" };
    expect(blockedBy("p", broken, {})).toBe(
      "This workflow does not parse: line 3: no nodes",
    );
  });

  it("sends only what differs from the defaults", () => {
    const values = {
      ...initialValues(WITH_INPUTS.inputs),
      feature: "csv",
      fast: "true",
    };
    expect(inputsToSend(WITH_INPUTS.inputs, values)).toEqual({
      feature: "csv",
      fast: "true",
    });
  });

  it("writes the same run as a command", () => {
    const values = { ...initialValues(WITH_INPUTS.inputs), feature: "csv" };
    expect(
      commandOf(WITH_INPUTS, values, {
        driver: "claude-code",
        inPlace: true,
        allowDirty: true,
        machineClaude: true,
      }),
    ).toBe(
      "ork run build --detach --input feature=csv --driver claude-code --in-place --allow-dirty --machine-claude",
    );
  });

  it("quotes what a shell would split or expand", () => {
    const values = { feature: "it's $HOME; rm" };
    expect(
      commandOf(workflowNamed("build", { feature: {} }), values, NO_FLAGS),
    ).toBe(
      String.raw`ork run build --detach --input 'feature=it'\''s $HOME; rm'`,
    );
  });
});
