/**
 * @file Which programs a workflow's tool nodes run, and which of them are not
 *   installed. Integrations are optional: `ork run` checks only the programs
 *   the workflow uses, before anything starts.
 */

import { accessSync, constants } from "node:fs";
import path from "node:path";

import {
  calledWorkflows,
  envReadsOf,
  type ProjectPlace,
} from "@krapht/ork-core";
import { integrationFor } from "@krapht/ork-integrations";
import { isToolNode, programsRunBy, type Workflow } from "@krapht/ork-schema";

import { mcpProblems } from "./mcp-servers.ts";
import { commandLineOf, tokenize } from "./tool-command.ts";
import { type Environ, readEnv } from "./tool-env.ts";

export type NeededProgram = { node: string; type: string; program: string };

const isRelativePath = (program: string): boolean =>
  program.includes(path.sep) && !path.isAbsolute(program);

/**
 * The programs the workflow's tool nodes run: an integration's own (`gh`,
 * `aws`), or the first word of a `tool.shell` command or interpreter, when it
 * is not a template. A relative path is not asked about: it means a node's
 * checkout, where a `before:` or an earlier node may yet make it.
 */
export const neededPrograms = (workflow: Workflow): NeededProgram[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) =>
    programsRunBy(node, workflow.defaults).flatMap(({ program }) => {
      const type = isToolNode(node) ? node.type : "tool.shell";
      const integration = integrationFor(type);
      if (integration === undefined) return [];
      if (integration.program !== null) {
        return [{ node: id, type, program: integration.program }];
      }
      const tokens = tokenize(commandLineOf(program) ?? "");
      const first = tokens.ok ? tokens.args[0] : undefined;
      return first === undefined ||
        first.includes("{{") ||
        isRelativePath(first)
        ? []
        : [{ node: id, type, program: first }];
    }),
  );

/** The `{{env.NAME}}` a workflow reads that are not set, with their nodes. */
export const missingEnv = (
  workflow: Workflow,
  environ: Environ = process.env,
  finished: ReadonlySet<string> = new Set(),
): { variable: string; nodes: string[] }[] => {
  const missing = new Map<string, Set<string>>();
  for (const [id, node] of Object.entries(workflow.nodes)) {
    if (finished.has(id)) continue;
    const values = programsRunBy(node, workflow.defaults).flatMap(
      ({ program }) => Object.values(program.env ?? {}),
    );
    for (const value of values) {
      for (const name of envReadsOf(value)) {
        if (readEnv(environ, name) !== undefined) continue;
        missing.set(name, (missing.get(name) ?? new Set()).add(id));
      }
    }
  }
  return [...missing].map(([variable, nodes]) => ({
    variable,
    nodes: [...nodes],
  }));
};

type History = ReadonlyMap<string, readonly { ok: boolean }[]>;

/** The nodes a resumed run hands back rather than runs: their last go worked. */
const finishedOf = (history: History): Set<string> =>
  new Set(
    [...history]
      .filter(([, results]) => results.at(-1)?.ok === true)
      .map(([id]) => id),
  );

/**
 * What a workflow this run may call reads and is not set. Whether a call runs
 * is often only known at run time, so this warns; the call fails if reached. A
 * call a resumed run already finished is not asked about.
 */
export const calledEnvWarning = (
  workflow: Workflow,
  own: ProjectPlace,
  registered: readonly ProjectPlace[],
  history: History = new Map(),
  environ: Environ = process.env,
): string[] => {
  const merged = new Map<string, Set<string>>();
  const unreadable: string[] = [];
  for (const called of calledWorkflows(workflow, own, registered, {
    finished: finishedOf(history),
    unreadable: name => {
      unreadable.push(name);
    },
  })) {
    for (const { variable, nodes } of missingEnv(called, environ)) {
      const seen = merged.get(variable) ?? new Set();
      for (const node of nodes) seen.add(`${called.name}/${node}`);
      merged.set(variable, seen);
    }
  }
  return [
    ...(merged.size === 0
      ? []
      : [
          "A workflow this run may call reads variables that are not set:",
          ...[...merged].map(
            ([variable, nodes]) =>
              `  ${variable}, for ${[...nodes].join(", ")}`,
          ),
          "That call fails if the run reaches it.",
        ]),
    ...(unreadable.length === 0
      ? []
      : [
          `Could not read ${unreadable.join(", ")}, which this run may call, so what ${unreadable.length === 1 ? "it reads" : "they read"} is neither checked nor masked.`,
        ]),
  ];
};

/** Why a run refuses to start when a variable its nodes read is not set. */
export const missingEnvMessage = (
  missing: ReturnType<typeof missingEnv>,
): string[] => [
  "This workflow reads environment variables that are not set:",
  ...missing.map(m => `  ${m.variable}, for ${m.nodes.join(", ")}`),
  "Set them, and run it again.",
];

/** Why a run refuses to start when a program its tool nodes need is missing. */
export const missingProgramMessage = (
  missing: readonly { program: string; nodes: string[]; type: string }[],
): string[] => [
  "This workflow runs programs that are not installed:",
  ...missing.map(m => `  ${m.program}, for ${m.nodes.join(", ")} (${m.type})`),
  "Install them, or take those nodes out. Integrations are optional: only the ones a workflow uses must be installed (`ork doctor` shows what you have).",
];

/**
 * What stops this run for want of a variable, as lines to print; what only
 * might stop it goes to `warn`.
 */
export const envProblems = (
  workflow: Workflow,
  own: ProjectPlace,
  registered: readonly ProjectPlace[],
  history: History | undefined,
  warn: (line: string) => void,
): string[] => {
  const unset = missingEnv(
    workflow,
    process.env,
    finishedOf(history ?? new Map()),
  );
  if (unset.length > 0) return missingEnvMessage(unset);
  const servers = mcpProblems(
    workflow,
    own.root,
    process.env,
    finishedOf(history ?? new Map()),
    program => isRelativePath(program) || onPath(program),
  );
  if (servers.length > 0) return servers;
  for (const line of calledEnvWarning(workflow, own, registered, history)) {
    warn(line);
  }
  return [];
};

const runnable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Whether `program` runs: a path that is executable, or a name on `PATH`. */
export const onPath = (
  program: string,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  if (program.includes(path.sep)) return runnable(program);
  return (env["PATH"] ?? "")
    .split(path.delimiter)
    .filter(dir => dir !== "")
    .some(dir => runnable(path.join(dir, program)));
};

/** The needed programs that are not installed, one entry per program. */
export const missingPrograms = (
  workflow: Workflow,
  installed: (program: string) => boolean = program => onPath(program),
): { program: string; nodes: string[]; type: string }[] => {
  const missing = new Map<
    string,
    { program: string; nodes: string[]; type: string }
  >();
  for (const need of neededPrograms(workflow)) {
    if (installed(need.program)) continue;
    const entry = missing.get(need.program) ?? {
      program: need.program,
      nodes: [],
      type: need.type,
    };
    entry.nodes.push(need.node);
    missing.set(need.program, entry);
  }
  return [...missing.values()];
};
