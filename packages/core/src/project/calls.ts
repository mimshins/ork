/**
 * @file `ork validate`'s check of `workflow.call` nodes against what they call
 *   (RFC-004): the project, the workflow, the node and the required inputs. A
 *   project not registered here is only a warning, since it may be on another
 *   machine; a run refuses it. A name with a template is left to the run.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type Diagnostic,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "../graph/diagnostics.ts";
import { placeFiles, type ProjectPlace } from "./place.ts";

const hasTemplate = (text: string): boolean => text.includes("{{");

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
    if (!existsSync(file)) {
      return [
        error(
          "call.workflow",
          `call "${id}": no workflow "${node.workflow}" in ${target.root}`,
          [...at, "workflow"],
        ),
      ];
    }
    const parsed = parseWorkflow(readFileSync(file, "utf8"));
    if (!parsed.ok) {
      return [
        error(
          "call.workflow",
          `call "${id}": the workflow "${node.workflow}" is not valid; run ork validate on it`,
          [...at, "workflow"],
        ),
      ];
    }
    const called = parsed.workflow;
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
