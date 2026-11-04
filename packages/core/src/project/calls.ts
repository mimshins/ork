/**
 * @file `ork validate`'s check of `workflow.call` nodes against what they call
 *   (RFC-004): the project, the workflow, the node and the required inputs. A
 *   project not registered here is only a warning, since it may be on another
 *   machine; a run refuses it. A name with a template is left to the run.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  type Diagnostic,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "../graph/diagnostics.ts";
import { placeFiles, type ProjectPlace } from "./place.ts";

const hasTemplate = (text: string): boolean => text.includes("{{");

/** A workflow's file: a folder of that name is no workflow. */
const fileState = (file: string): "file" | "none" | "unreadable" => {
  try {
    return statSync(file, { throwIfNoEntry: false })?.isFile() === true
      ? "file"
      : "none";
  } catch {
    return "unreadable";
  }
};

/** A workflow from its file, or `null` when it cannot be read or is not valid. */
const readWorkflow = (file: string): Workflow | null => {
  try {
    const parsed = parseWorkflow(readFileSync(file, "utf8"));
    return parsed.ok ? parsed.workflow : null;
  } catch {
    return null;
  }
};

/**
 * The workflows a workflow calls by a literal name, and those they call. One
 * that cannot be read is left out: `ork validate` and the call report it. A
 * call of one `node:` runs only that session, so its tool nodes do not count
 * unless `everyCall`, and nor does a call among `finished`. `unreadable` hears
 * of one that is there but could not be read.
 */
export const calledWorkflows = (
  workflow: Workflow,
  own: ProjectPlace,
  registered: readonly ProjectPlace[],
  options: {
    everyCall?: boolean;
    finished?: ReadonlySet<string>;
    unreadable?: (name: string) => void;
  } = {},
): Workflow[] => {
  const seen = new Set<string>();
  const found: Workflow[] = [];
  const walk = (from: Workflow, place: ProjectPlace): void => {
    for (const [id, node] of Object.entries(from.nodes)) {
      if (node.type !== "workflow.call") continue;
      if (hasTemplate(node.workflow) || hasTemplate(node.project ?? "")) {
        continue;
      }
      if (options.everyCall !== true && node.node !== undefined) continue;
      if (from === workflow && options.finished?.has(id) === true) continue;
      const target =
        node.project === undefined
          ? place
          : registered.find(other => other.id === node.project);
      if (target === undefined) continue;
      const file = path.join(
        placeFiles(target).workflows,
        `${path.basename(node.workflow)}.ork.yaml`,
      );
      if (seen.has(file)) continue;
      seen.add(file);
      const state = fileState(file);
      if (state === "none") continue;
      const called = state === "file" ? readWorkflow(file) : null;
      if (called === null) {
        options.unreadable?.(node.workflow);
        continue;
      }
      found.push(called);
      walk(called, target);
    }
  };
  walk(workflow, own);
  return found;
};

export const checkCallTargets = (
  workflow: Workflow,
  own: ProjectPlace,
  registered: readonly ProjectPlace[],
): Diagnostic[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "workflow.call") return [];
    const at = ["nodes", id];
    if (hasTemplate(node.workflow) || hasTemplate(node.project ?? ""))
      return [];
    if (/[/\\]/u.test(node.workflow) || node.workflow === "..") {
      return [
        error(
          "call.workflow",
          `call "${id}": "${node.workflow}" is not a workflow's name`,
          [...at, "workflow"],
        ),
      ];
    }
    const target =
      node.project === undefined
        ? own
        : registered.find(place => place.id === node.project);
    if (target === undefined) {
      return [
        warning(
          "call.project",
          `call "${id}": project "${String(node.project)}" is not registered here, so a run will refuse it; register it with ork register`,
          [...at, "project"],
        ),
      ];
    }
    const file = path.join(
      placeFiles(target).workflows,
      `${node.workflow}.ork.yaml`,
    );
    const state = fileState(file);
    if (state === "none") {
      return [
        error(
          "call.workflow",
          `call "${id}": no workflow "${node.workflow}" in ${target.root}`,
          [...at, "workflow"],
        ),
      ];
    }
    const called = state === "file" ? readWorkflow(file) : null;
    if (called === null) {
      return [
        error(
          "call.workflow",
          `call "${id}": the workflow "${node.workflow}" cannot be read or is not valid; run ork validate on it`,
          [...at, "workflow"],
        ),
      ];
    }
    const found: Diagnostic[] = [];
    if (node.node !== undefined) {
      const type = called.nodes[node.node]?.type;
      if (type !== "claude.leader" && type !== "claude.worker") {
        found.push(
          error(
            "call.node",
            `call "${id}": "${node.node}" is not a leader or worker of ${node.workflow}`,
            [...at, "node"],
          ),
        );
      }
    }
    for (const [name, input] of Object.entries(called.inputs ?? {})) {
      if (
        input.required === true &&
        input.default === undefined &&
        node.inputs?.[name] === undefined
      ) {
        found.push(
          error(
            "call.input",
            `call "${id}": ${node.workflow} requires the input "${name}"`,
            [...at, "inputs"],
          ),
        );
      }
    }
    return found;
  });
