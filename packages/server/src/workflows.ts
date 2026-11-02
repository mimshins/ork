/**
 * @file A project's workflows, for the UI's Run workflow dialog: each
 *   `*.ork.yaml` in its workflows folder, with its name, description and
 *   declared inputs; one that does not parse is listed with why, since starting
 *   it is how the user sees the whole error.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { placeFiles, type ProjectRecord } from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";

import type { WorkflowView } from "./contract.ts";

const SUFFIX = ".ork.yaml";

const viewOf = (file: string): WorkflowView => {
  const name = path.basename(file).slice(0, -SUFFIX.length);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name, file, inputs: {}, error: reason };
  }
  const parsed = parseWorkflow(text);
  if (!parsed.ok) {
    const [first] = parsed.diagnostics;
    return {
      name,
      file,
      inputs: {},
      error: first?.message ?? "It is not a valid workflow.",
    };
  }
  const { workflow } = parsed;
  return {
    name,
    file,
    title: workflow.name,
    ...(workflow.description === undefined
      ? {}
      : { description: workflow.description }),
    inputs: workflow.inputs ?? {},
  };
};

/** The workflows in `project`'s workflows folder, by name. */
export const projectWorkflows = (project: ProjectRecord): WorkflowView[] => {
  const folder = placeFiles(project).workflows;
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter(name => name.endsWith(SUFFIX))
    .toSorted()
    .map(name => viewOf(path.join(folder, name)));
};
