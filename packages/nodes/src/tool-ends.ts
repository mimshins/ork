/**
 * @file How a tool node ended (specs/runtime/session-ends.md): a node that
 *   could not run its command, JSON that broke its declared output, or how a
 *   command that ran exited: done, stopped, never started, signed out, or
 *   failed. Ork's message names the program; its stderr is the detail.
 */

import {
  END_DETAIL_LIMIT,
  endedWith,
  endFor,
  type EndKind,
  type ExecuteContext,
  type NodeOutput,
  type NodeResult,
} from "@krapht/ork-core";

import type { ToolRun } from "./tool-command.ts";

/** A node that could not run its command: its own definition is wrong. */
export const failed = (
  error: string,
  kind: EndKind = "invalid_node",
): NodeResult =>
  endedWith(
    { ok: false, output: { exitCode: -1, stdout: "", stderr: error } },
    endFor(kind, { reason: error }, error),
  );

/** JSON that broke what the node declares, or that it could not read. */
export const invalidOutput = (output: NodeOutput, reason: string): NodeResult =>
  endedWith({ ok: false, output }, endFor("invalid_output", { reason }));

/**
 * How a command that ran and exited non-zero ended: stopped, never started, a
 * sign-in its program asks for (`signedOut`), or a plain failure.
 */
const exitKind = (
  run: ToolRun,
  context: ExecuteContext,
  signedOut: ((run: ToolRun) => boolean) | undefined,
): EndKind => {
  if (context.signal.aborted) return "interrupted";
  // Both runners say a program that would not spawn with exit code -1.
  if (run.exitCode === -1 && /\bENOENT\b/u.test(run.stderr)) {
    return "tool_missing";
  }
  return signedOut?.(run) === true ? "auth" : "command_failed";
};

/** How a command that ran ended, by its exit code; `program` is scrubbed. */
export const exitEnd = (
  output: NodeOutput,
  run: ToolRun,
  context: ExecuteContext,
  program: string,
  signedOut: ((run: ToolRun) => boolean) | undefined,
): NodeResult => {
  if (run.exitCode === 0)
    return endedWith({ ok: true, output }, endFor("done"));
  const end = endFor(
    exitKind(run, context, signedOut),
    { program, exitCode: run.exitCode },
    // The end of stderr says why; all of it is in the output.
    run.stderr.trim().slice(-END_DETAIL_LIMIT),
  );
  // Only a transient kind is `transient`; a `watch:` looks again by kind.
  return endedWith({ ok: false, output }, end);
};
