/**
 * @file Stops a run whose session node names an exact `provider/model` that the
 *   node's driver does not list (`omp models --json`), before any spend
 *   (RFC-026 option 6C). Only an exact form is checked: a fuzzy name, a role or
 *   a templated model is left to the tool, and a list that cannot be read says
 *   nothing. The list is read once per driver per run, and only when some node
 *   qualifies. `ork validate` stays offline and never asks.
 */

import { modelDriver, nodeDriver, writtenModel } from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import type { Driver, Workflow } from "@krapht/ork-schema";

import { exec } from "../doctor/checks.ts";

/**
 * The exact selectors `driver` reaches, or `null` when it cannot list them;
 * tests pass their own, so no real tool runs.
 */
export type ModelList = (driver: Driver) => Promise<readonly string[] | null>;

/** The real list: the driver's own `models` hook on this machine. */
export const modelsHere: ModelList = async driver =>
  (await AGENT_DRIVERS.find(({ id }) => id === driver)?.models?.(
    exec,
    process.env,
  )) ?? null;

/**
 * One refusal line per session node whose exact model is not among its driver's
 * selectors. `choice` is as for `unfitLines`.
 */
export const modelRefusals = async (
  workflow: Workflow,
  choice: { override?: Driver | undefined; ready?: Driver | undefined },
  list: ModelList = modelsHere,
): Promise<string[]> => {
  const exact = Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "agent.leader" && node.type !== "agent.worker") return [];
    const written = writtenModel(node, workflow);
    const driver = nodeDriver(node, workflow, choice);
    if (written === undefined || driver === undefined) return [];
    const model = modelDriver(written).model;
    if (!model.includes("/") || model.includes("{{")) return [];
    // Only a driver that can list its models is asked, so no other costs a process.
    return AGENT_DRIVERS.some(d => d.id === driver && d.models !== undefined)
      ? [{ id, driver, model }]
      : [];
  });
  const drivers = [...new Set(exact.map(each => each.driver))];
  const lists = new Map(
    await Promise.all(
      drivers.map(async driver => [driver, await list(driver)] as const),
    ),
  );
  return exact.flatMap(({ id, driver, model }) => {
    const known = lists.get(driver);
    return known === undefined ||
      known === null ||
      known.length === 0 ||
      known.includes(model)
      ? []
      : [
          `node \`${id}\` names model \`${model}\`, which is not in \`${driver} models\`; write an exact \`provider/model\` that \`${driver} models\` lists.`,
        ];
  });
};
