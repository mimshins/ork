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
