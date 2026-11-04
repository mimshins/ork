/**
 * @file What a tool node's program sees besides what it inherits: who it is
 *   (`ORK_*`), and the node's `env:`, rendered as templates. Only `env:` may
 *   read the user's own variables, so their values never reach a recorded
 *   command, and those values are scrubbed from what the program prints.
 */

import {
  calledWorkflows,
  envReadsOf,
  type ExecuteContext,
  parseTemplate,
  type ProjectPlace,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import { isToolNode, type ToolNode, type Workflow } from "@krapht/ork-schema";

import type { ToolRunner } from "./tools.ts";

export type Environ = Readonly<Record<string, string | undefined>>;

/** The file a node with `output: { format: json }` may write its result to. */
export const OUTPUT_ENV = "ORK_OUTPUT";

/** Set for a program in a run. */
export const RUN_ENV = "ORK_RUN";

/** Set for a Claude session. It says no more than that: no run, no node. */
const SESSION_ENV = "ORK_SESSION";

/** The variables a caller's run reads, for a run it calls to mask too. */
const MASKED_ENV = "ORK_MASKED";

/** Every variable Ork sets itself; a workflow's `env:` cannot set them. */
const IDENTITY_KEYS = new Set([
  RUN_ENV,
  SESSION_ENV,
  MASKED_ENV,
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

/**
 * The variable that says a program in a run or a session started this process,
 * or `null` when none does.
 */
export const runMarkerIn = (env: Environ): string | null =>
  [RUN_ENV, SESSION_ENV].find(name => env[name] !== undefined) ?? null;

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

/** A variable of the user's: only its own, as an expression reads them. */
export const readEnv = (environ: Environ, name: string): string | undefined =>
  Object.hasOwn(environ, name) ? environ[name] : undefined;

/** The variables a workflow's nodes read that no `plainEnv` excuses. */
const secretNamesOf = (workflow: Workflow): string[] =>
  Object.values(workflow.nodes).flatMap(node => {
    if (!isToolNode(node)) return [];
    const plain = new Set(node.plainEnv);
    return Object.values(node.env ?? {})
      .flatMap(value => envReadsOf(value))
      .filter(name => !plain.has(name));
  });

/** What the run that called this one told it to mask. */
const inheritedNames = (environ: Environ): string[] =>
  (environ[MASKED_ENV] ?? "").split(",").filter(name => name !== "");

/**
 * The variables a run must mask: what its workflow reads, what the workflows it
 * calls by name read, and what its caller reads. Any of them may print any of
 * these, since a called run inherits the same environment.
 */
export const maskedNamesOfRun = (
  workflow: Workflow,
  own: ProjectPlace,
  registered: readonly ProjectPlace[],
  environ: Environ = process.env,
): string[] => [
  ...new Set(
    [
      workflow,
      ...calledWorkflows(workflow, own, registered, { everyCall: true }),
    ]
      .flatMap(one => secretNamesOf(one))
      .concat(inheritedNames(environ)),
  ),
];

/** What a run tells a run it calls: names, never values. */
export const maskedEnv = (names: readonly string[]): Record<string, string> =>
  names.length === 0 ? {} : { [MASKED_ENV]: names.join(",") };

/** The values to mask: what the workflow reads, and the names given. */
export const secretsOf = (
  workflow: Workflow,
  environ: Environ,
  also: readonly string[] = [],
): string[] =>
  [
    ...new Set([
      ...secretNamesOf(workflow),
      ...also,
      ...inheritedNames(environ),
    ]),
  ].flatMap(name => {
    const value = readEnv(environ, name);
    return value === undefined ? [] : [value];
  });

/** A node's `env:`, rendered. */
export const renderEnv = (
  node: ToolNode,
  context: Pick<ExecuteContext, "inputs" | "outputs" | "runId">,
  environ: Environ,
):
  | { ok: true; values: Record<string, string> }
  | { ok: false; error: string } => {
  const values: Record<string, string> = {};
  const scope = {
    ...runScope(context.inputs, context.outputs, context.runId),
    // A bare name reads inside `output`: nothing else here can read `env`.
    output: { env: environ },
  };
  for (const [key, text] of Object.entries(node.env ?? {})) {
    const template = parseTemplate(text);
    if (!template.ok) return { ok: false, error: template.message };
    for (const name of envReadsOf(text)) {
      if (readEnv(environ, name) === undefined) {
        return {
          ok: false,
          error: `env.${key} reads ${name}, which is not set`,
        };
      }
    }
    const value = renderTemplate(template.parts, scope);
    // The system's own refusal of this prints the whole value.
    if (value.includes("\0")) {
      return { ok: false, error: `env.${key} holds a null byte` };
    }
    values[key] = value;
  }
  return { ok: true, values };
};

/** A runner whose refusal to start is a failed run, with nothing secret in it. */
export const safeRunner =
  (runner: ToolRunner, scrub: (text: string) => string): ToolRunner =>
  async (program, args, options) => {
    try {
      return await runner(program, args, options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { exitCode: -1, stdout: "", stderr: scrub(reason) };
    }
  };
