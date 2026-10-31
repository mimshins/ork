/**
 * @file The integration port: what Ork needs to know about one of the user's
 *   own CLI tools (GitHub, AWS, any program) to validate its nodes, run them,
 *   and check the user's login. Adding an integration is one adapter file that
 *   satisfies `Integration`, listed in the registry (ADR-022).
 */

import type { z } from "zod";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

/** One line of `ork doctor`. */
export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when the status is not `ok`. */
  hint?: string;
};

export type ExecResult = { ok: boolean; stdout: string };

/** Runs a program without a shell. Never rejects. */
export type Exec = (
  program: string,
  args: readonly string[],
) => Promise<ExecResult>;

export type Env = Readonly<Record<string, string | undefined>>;

/** Runs the integration's own program with arguments, in the node's folder. */
export type ProgramExec = (args: readonly string[]) => Promise<ExecResult>;

export type Integration<Options extends z.ZodRawShape = z.ZodRawShape> = {
  /** The node type is `tool.<id>`. */
  id: string;
  /** What `ork doctor` and the docs call it, e.g. "GitHub CLI". */
  label: string;
  /** The user's program, or `null` when the command's first word names it. */
  program: string | null;
  /** Node fields beyond `command`, `allow` and `cwd`, e.g. AWS's `profile`. */
  options: Options;
  /** The arguments those fields add after the command's own. */
  args(node: Partial<z.infer<z.ZodObject<Options>>>): string[];
  /**
   * The allow list a node has when it sets none (git: `add`, `commit`).
   * Omitted, a node without `allow` may run any command.
   */
  allow?: readonly string[];
  /**
   * Output fields read after the command ran, in the same folder (git: the
   * staged changes), so a later gate can show them. `fields` names them for the
   * compiler's reference checks; a field over the output limit is cut like
   * stdout.
   */
  observe?: {
    fields: readonly string[];
    read: (run: ProgramExec) => Promise<Record<string, string>>;
  };
  /**
   * Whether the program is installed and the user is signed in, without ever
   * printing a token or an account secret. Omitted when there is nothing to
   * check (any program).
   */
  doctor?: (exec: Exec, env: Env) => Promise<CheckResult>;
};

/** Declares an integration with its option types checked. */
export const defineIntegration = <Options extends z.ZodRawShape>(
  integration: Integration<Options>,
): Integration<Options> => integration;
