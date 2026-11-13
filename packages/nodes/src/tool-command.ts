/**
 * @file A tool node's command line, split without a shell: Ork starts programs
 *   directly, so nothing in a rendered value can run as a command. And the
 *   contract of what runs it, what a run of it gives back, and, with `once:
 *   true` (a tool node or a `verify:`), whether it runs: a check that passed on
 *   identical files is skipped (`runOnce`) and the run records
 *   `verify.skipped`; a failure records nothing; `ORK_ONCE=off` always runs
 *   it.
 */

import {
  type CpuTime,
  type Environ,
  type ExecuteContext,
  runOnce,
} from "@krapht/ork-core";
import type { Priority, ToolNode } from "@krapht/ork-schema";

/** What runs a `script:` with no `interpreter:`: it stops at the first failure. */
export const DEFAULT_INTERPRETER = "sh -eu";

/**
 * The command line a tool node declares: its `command`, or what runs its
 * script.
 */
export const commandLineOf = (
  node: Pick<ToolNode, "command" | "script" | "interpreter">,
): string | undefined =>
  node.script === undefined
    ? node.command
    : (node.interpreter ?? DEFAULT_INTERPRETER);

/**
 * Splits a command into arguments the way a shell would, without running one:
 * whitespace separates, `'…'` is literal, `"…"` and `\` escape, and `{{ … }}`
 * stays whole so a template is rendered inside its own argument.
 */
export const tokenize = (
  command: string,
): { ok: true; args: string[] } | { ok: false; error: string } => {
  const args: string[] = [];
  let current: string | null = null;
  let index = 0;
  const add = (text: string) => {
    current = (current ?? "") + text;
  };
  while (index < command.length) {
    const char = command.charAt(index);
    if (command.startsWith("{{", index)) {
      const end = command.indexOf("}}", index + 2);
      if (end === -1) return { ok: false, error: "unclosed {{ in command" };
      add(command.slice(index, end + 2));
      index = end + 2;
    } else if (/\s/u.test(char)) {
      if (current !== null) args.push(current);
      current = null;
      index += 1;
    } else if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return { ok: false, error: "unclosed ' in command" };
      add(command.slice(index + 1, end));
      index = end + 1;
    } else if (char === '"') {
      let text = "";
      index += 1;
      while (index < command.length && command.charAt(index) !== '"') {
        if (command.charAt(index) === "\\") index += 1;
        text += command.charAt(index);
        index += 1;
      }
      if (index >= command.length) {
        return { ok: false, error: 'unclosed " in command' };
      }
      add(text);
      index += 1;
    } else if (char === "\\") {
      add(command.charAt(index + 1));
      index += 2;
    } else {
      add(char);
      index += 1;
    }
  }
  if (current !== null) args.push(current);
  return { ok: true, args };
};

export type ToolRun = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** What it used, its children included, when the runner can tell. */
  cpu?: CpuTime;
};

/** Starts a program with arguments, never through a shell. */
export type ToolRunner = (
  program: string,
  args: readonly string[],
  options: {
    cwd: string;
    signal: AbortSignal;
    /** Set for this program, over what it inherits. */
    env?: Readonly<Record<string, string>>;
    /** `low`: the program starts at a lower OS priority than Ork. */
    priority?: Priority;
  },
) => Promise<ToolRun>;

/**
 * Runs `execute`, or, with `once: true`, skips it after a pass on these files:
 * `null` then, and `verify.skipped` is recorded. `shown` is the scrubbed
 * command.
 */
export const runUnlessPassed = async ({
  node,
  context,
  cwd,
  shown,
  environ,
  execute,
}: {
  node: Pick<ToolNode, "once" | "script">;
  context: Pick<ExecuteContext, "runId" | "id" | "skipped">;
  cwd: string;
  shown: string;
  environ: Environ;
  execute: () => Promise<ToolRun>;
}): Promise<ToolRun | null> => {
  if (node.once !== true) return execute();
  const done: { run?: ToolRun } = {};
  const once = await runOnce({
    cwd,
    // A script's text is the check too, not only what runs it.
    name: node.script === undefined ? shown : `${shown}\n${node.script}`,
    who: `${context.runId}/${context.id}`,
    env: environ,
    run: async () => {
      done.run = await execute();
      return done.run.exitCode;
    },
  });
  // Not skipped, `runOnce` ran it.
  if (!once.skipped) return done.run ?? execute();
  context.skipped?.(shown, once.pass);
  return null;
};
