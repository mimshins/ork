/**
 * @file Which programs a workflow's tool nodes run, and which of them are not
 *   installed. Integrations are optional: `ork run` checks only the programs
 *   the workflow uses, before anything starts.
 */

import { accessSync, constants } from "node:fs";
import path from "node:path";

import { integrationFor } from "@krapht/ork-integrations";
import { isToolNode, type Workflow } from "@krapht/ork-schema";

import { tokenize } from "./tools.ts";

export type NeededProgram = { node: string; type: string; program: string };

/**
 * The programs the workflow's tool nodes run: an integration's own (`gh`,
 * `aws`), or a `tool.shell` command's first word when it is not a template.
 */
export const neededPrograms = (workflow: Workflow): NeededProgram[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (!isToolNode(node)) return [];
    const integration = integrationFor(node.type);
    if (integration === undefined) return [];
    if (integration.program !== null) {
      return [{ node: id, type: node.type, program: integration.program }];
    }
    const tokens = tokenize(node.command);
    const first = tokens.ok ? tokens.args[0] : undefined;
    return first === undefined || first.includes("{{")
      ? []
      : [{ node: id, type: node.type, program: first }];
  });

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
