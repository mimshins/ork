/**
 * @file What a tool node's program sees besides what it inherits: who it is
 *   (`ORK_*`), and the node's `env:`, rendered as templates. Only `env:` may
 *   read the user's own variables, so their values never reach a recorded
 *   command, and those values are scrubbed from what the program prints.
 */

import {
  collectPaths,
  type ExecuteContext,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import type { ToolNode } from "@krapht/ork-schema";

export type Environ = Readonly<Record<string, string | undefined>>;

/** The file a node with `output: { format: json }` may write its result to. */
export const OUTPUT_ENV = "ORK_OUTPUT";

/** Set for a program in a run. */
export const RUN_ENV = "ORK_RUN";

/** Set for a Claude session. It says no more than that: no run, no node. */
const SESSION_ENV = "ORK_SESSION";

/** Every variable Ork sets itself; a workflow's `env:` cannot set them. */
const IDENTITY_KEYS = new Set([
  RUN_ENV,
  SESSION_ENV,
  "ORK_NODE",
  "ORK_ROUND",
  "ORK_RUN_DIR",
  "ORK_PROJECT",
  "ORK_WORKFLOW",
  "ORK_BIN",
  OUTPUT_ENV,
]);

/**
 * `env` without Ork's identity variables. A run started by a program in another
 * run must not pass that run's identity on to its own sessions and programs.
 */
export const withoutIdentity = (env: Environ): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      value === undefined || IDENTITY_KEYS.has(key)
        ? []
        : [[key, value] as const],
    ),
  );

/**
 * What a Claude session runs with: no identity, only the marker that stops its
 * Bash from speaking as the user through `ork chat`.
 */
export const sessionEnv = (env: Environ): Record<string, string> => ({
  ...withoutIdentity(env),
  [SESSION_ENV]: "1",
});

/** Whether this process was started by a program in a run or by a session. */
export const startedByARun = (env: Environ): boolean =>
  env[RUN_ENV] !== undefined || env[SESSION_ENV] !== undefined;

/** Who a node's program is. It is attribution, not a security boundary. */
export const identityOf = (
  context: Pick<
    ExecuteContext,
    "runId" | "id" | "round" | "runDir" | "projectRoot" | "workflow"
  >,
  orkBin: string | undefined,
): Record<string, string> => ({
  [RUN_ENV]: context.runId,
  ORK_NODE: context.id,
  ORK_ROUND: String(context.round),
  ORK_RUN_DIR: context.runDir,
  ORK_PROJECT: context.projectRoot,
  ORK_WORKFLOW: context.workflow.name,
  ...(orkBin === undefined ? {} : { ORK_BIN: orkBin }),
});

/** The user's variables a value of `env:` reads through `{{env.NAME}}`. */
export const envReadsOf = (value: string): string[] => {
  const template = parseTemplate(value);
  if (!template.ok) return [];
  return template.parts.flatMap(part =>
    typeof part === "string"
      ? []
      : collectPaths(part.expr).flatMap(([root, name]) =>
          root === "env" && name !== undefined ? [String(name)] : [],
        ),
  );
};

/** Shorter values than this would mask ordinary text: `1`, `true`, a word. */
const MIN_SECRET_LENGTH = 8;

/** Replaces the values with `[masked]`, the longest first. */
export const scrubberOf = (values: readonly string[]) => {
  const secrets = values
    .filter(value => value.length >= MIN_SECRET_LENGTH)
    .toSorted((a, b) => b.length - a.length);
  return (text: string): string =>
    secrets.reduce((out, secret) => out.replaceAll(secret, "[masked]"), text);
};

/** A node's `env:`, rendered, and what must not show in its output. */
export const renderEnv = (
  node: ToolNode,
  context: Pick<ExecuteContext, "inputs" | "outputs" | "runId">,
  environ: Environ,
):
  | { ok: true; values: Record<string, string>; secrets: string[] }
  | { ok: false; error: string } => {
  const values: Record<string, string> = {};
  const secrets: string[] = [];
  const scope = {
    ...runScope(context.inputs, context.outputs, context.runId),
    // A bare name reads inside `output`: nothing else here can read `env`.
    output: { env: environ },
  };
  for (const [key, text] of Object.entries(node.env ?? {})) {
    const template = parseTemplate(text);
    if (!template.ok) return { ok: false, error: template.message };
    for (const name of envReadsOf(text)) {
      const value = environ[name];
      if (value === undefined) {
        return {
          ok: false,
          error: `env.${key} reads ${name}, which is not set`,
        };
      }
      secrets.push(value);
    }
    values[key] = renderTemplate(template.parts, scope);
  }
  return { ok: true, values, secrets };
};
