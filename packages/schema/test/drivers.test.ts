/**
 * @file Tests for the `driver` field under RFC-014: the new ids load, and the
 *   retired `sdk` and `cli` are refused with the id that replaced them, in a
 *   workflow and in a project file alike.
 */

import { describe, expect, it } from "vitest";

import { parseProject, parseWorkflow } from "../src/index.ts";

const workflow = (driver: string) =>
  parseWorkflow(
    `schemaVersion: 1\nname: x\nnodes:\n  a:\n    type: agent.worker\n    prompt: hi\n    driver: ${driver}\n`,
  );

/** The diagnostics' messages of a parse; none when it loaded. */
const messages = (
  result: ReturnType<typeof parseProject> | ReturnType<typeof parseWorkflow>,
) => (result.ok ? [] : result.diagnostics.map(d => d.message));

describe("the driver field", () => {
  it("takes claude-code", () => {
    expect(workflow("claude-code").ok).toBe(true);
  });

  it.each(["sdk", "cli"])("refuses `%s` and names claude-code", id => {
    expect(messages(workflow(id))).toEqual([
      `driver \`${id}\` was retired; use \`claude-code\``,
    ]);
    expect(
      messages(parseProject(`schemaVersion: 1\ndefaults:\n  driver: ${id}\n`)),
    ).toEqual([`driver \`${id}\` was retired; use \`claude-code\``]);
  });

  it("refuses an unknown id with the list", () => {
    expect(messages(workflow("codex"))).toEqual([
      "Invalid option: expected one of `claude-code`|`open-code`|`command-code`",
    ]);
  });
});
