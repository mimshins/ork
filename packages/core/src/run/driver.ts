/**
 * @file Which agent driver a session runs on, one rule for every caller (`ork
 *   run`, `--node`, `ork chat`, `ork resume`, called and detached runs): the
 *   driver its model names (`claude-code.opus`, RFC-015), else `--driver`, else
 *   the node's (or its agent's), else the workflow's `defaults.driver` (the
 *   project's included), else the one ready on this machine when the run
 *   started. No driver is written into a workflow for lack of one.
 */

import { DRIVER_IDS } from "@krapht/ork-integrations";
import {
  type Driver,
  driverOf,
  isClaudeNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

/** The node types that start a session of their own, and so need a driver. */
const SESSION_TYPES: ReadonlySet<Node["type"]> = new Set([
  "agent.leader",
  "agent.worker",
]);

/**
 * A `model` value read once: the driver it names, if any, and what that tool
 * receives. A plain model (`deepseek/deepseek-v4.1-flash`) names none.
 */
export const modelDriver = (
  model: string,
): { driver: Driver | undefined; model: string } => {
  const parsed = driverOf(model, DRIVER_IDS);
  return {
    driver: DRIVER_IDS.find(id => id === parsed.driver),
    model: parsed.model,
  };
};

/**
 * The model a node asks for as written: its own (or its agent's), else the
 * default.
 */
export const writtenModel = (
  node: Node,
  workflow: Workflow,
): string | undefined =>
  isClaudeNode(node) ? (node.model ?? workflow.defaults?.model) : undefined;

/**
 * The driver a node's model pins it to, as written. A template
 * (`{{item.model}}`) pins nothing here: each item's plan reads what it
 * renders.
 */
export const pinnedDriver = (
  node: Node,
  workflow: Workflow,
): Driver | undefined => {
  const model = writtenModel(node, workflow);
  return model === undefined ? undefined : modelDriver(model).driver;
};

/** The driver a workflow names for a node, if it names one. */
export const namedDriver = (
  node: Node,
  workflow: Workflow,
): Driver | undefined =>
  ("driver" in node ? node.driver : undefined) ?? workflow.defaults?.driver;

/**
 * Why a node's own `driver` and the driver its model names disagree, or
 * `undefined` when they agree or either is absent. `model` is the value as
 * written, or as an item rendered it.
 */
export const driverContradiction = (
  node: Node,
  model: string | undefined,
): string | undefined => {
  const own = "driver" in node ? node.driver : undefined;
  if (own === undefined || model === undefined) return undefined;
  const pinned = modelDriver(model).driver;
  return pinned === undefined || pinned === own
    ? undefined
    : `model \`${model}\` names driver \`${pinned}\`, but the node sets \`driver: ${own}\`; remove one, or make them agree`;
};

/** The session nodes that name no driver, which take the one ready here. */
export const namingNoDriver = (workflow: Workflow): string[] =>
  Object.entries(workflow.nodes)
    .filter(
      ([, node]) =>
        SESSION_TYPES.has(node.type) &&
        pinnedDriver(node, workflow) === undefined &&
        namedDriver(node, workflow) === undefined,
    )
    .map(([id]) => id);

/**
 * The driver a session runs on: `pinned` (its model's prefix), else `override`
 * (`--driver`), else what the workflow names, else `ready`, the driver the run
 * found ready when it started (and recorded, for a resume). `undefined` only
 * when none applies, which a run refuses before it starts.
 */
export const sessionDriver = (choice: {
  pinned?: Driver | undefined;
  override?: Driver | undefined;
  named?: Driver | undefined;
  ready?: Driver | undefined;
}): Driver | undefined =>
  choice.pinned ?? choice.override ?? choice.named ?? choice.ready;

/** `sessionDriver` for a node of the workflow, as written. */
export const nodeDriver = (
  node: Node,
  workflow: Workflow,
  choice: { override?: Driver | undefined; ready?: Driver | undefined },
): Driver | undefined =>
  sessionDriver({
    pinned: pinnedDriver(node, workflow),
    override: choice.override,
    named: namedDriver(node, workflow),
    ready: choice.ready,
  });
