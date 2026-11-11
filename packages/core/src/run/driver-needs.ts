/**
 * @file What a node needs of its driver, checked against the driver's declared
 *   `capabilities` and `proven` alone (RFC-014), so `ork validate` and `ork
 *   run` refuse a node the driver can't serve before anything is spent. Where
 *   Ork has a fallback (the report, permission rules, a message at the next
 *   leg) a missing capability is not a refusal.
 */

import type { AgentDriver } from "@krapht/ork-integrations";
import {
  type Driver,
  isClaudeNode,
  type Node,
  type Workflow,
} from "@krapht/ork-schema";

import { driverQueues } from "./driver-queues.ts";
import { modelDriver, nodeDriver } from "./driver.ts";

/** The part of a driver descriptor a refusal reads. */
export type DriverNeeds = Pick<
  AgentDriver,
  "id" | "capabilities" | "proven" | "onePerCheckout"
>;

export type DriverRefusal = { node: string; message: string };

const SESSION_TYPES: ReadonlySet<Node["type"]> = new Set([
  "agent.leader",
  "agent.worker",
]);

/** The node's turn limit and dollar budget, its own or the workflow's default. */
const limitsOf = (
  node: Node,
  workflow: Workflow,
): { maxTurns: number | undefined; budgetUsd: number | undefined } => {
  const own = isClaudeNode(node) ? node : undefined;
  return {
    maxTurns: own?.maxTurns ?? workflow.defaults?.maxTurns,
    budgetUsd: own?.budgetUsd ?? workflow.defaults?.budgetUsd,
  };
};

/**
 * What a node asks of Ork's tools: `delegate` to its children (which also
 * brings their questions to it).
 */
const askOfTools = (
  id: string,
  node: Node,
  workflow: Workflow,
): string | undefined => {
  if (node.type !== "agent.leader") return undefined;
  const owns = Object.values(workflow.nodes).some(
    child =>
      child.parent === id &&
      (child.type === "agent.leader" || child.type === "agent.worker"),
  );
  return owns ? "delegates to the nodes it owns" : undefined;
};

/**
 * What a session's sub-agents ask of its driver: that it runs subagents at all,
 * and that a sub-agent's model names no other driver.
 */
const subagentRefusals = (
  id: string,
  workflow: Workflow,
  driver: DriverNeeds,
): DriverRefusal[] =>
  Object.entries(workflow.nodes).flatMap(([child, node]) => {
    if (node.type !== "agent.subagent" || node.parent !== id) return [];
    const runs = `sub-agent \`${child}\` runs in \`${id}\`'s session on driver \`${driver.id}\``;
    const pinned =
      node.model === undefined ? undefined : modelDriver(node.model).driver;
    return [
      ...(driver.capabilities.subagents
        ? []
        : [`${runs}, which does not run subagents`]),
      ...(pinned === undefined || pinned === driver.id
        ? []
        : [
            `${runs}, but its model \`${node.model ?? ""}\` names driver \`${pinned}\``,
          ]),
    ].map(message => ({ node: child, message }));
  });

/**
 * What stops one session node from running on `driver`, its sub-agents
 * included. A run checks each `forEach` item's this way too, when the model it
 * rendered names the driver.
 */
export const sessionRefusals = (
  id: string,
  node: Node,
  workflow: Workflow,
  driver: DriverNeeds,
): DriverRefusal[] => {
  const { maxTurns, budgetUsd } = limitsOf(node, workflow);
  const refuse = (message: string): DriverRefusal => ({
    node: id,
    message: `node \`${id}\` ${message}`,
  });
  const refusals: DriverRefusal[] = [];
  if (!driver.proven) {
    refusals.push(
      refuse(
        `runs on driver \`${driver.id}\`, which is not yet proven on a real session`,
      ),
    );
  }
  if (maxTurns !== undefined && !driver.capabilities.turnLimit) {
    refusals.push(
      refuse(`sets maxTurns, but driver \`${driver.id}\` has no turn limit`),
    );
  }
  if (budgetUsd !== undefined && !driver.capabilities.price) {
    refusals.push(
      refuse(
        `sets budgetUsd, but driver \`${driver.id}\` does not report cost in dollars (a token budget comes with RFC-015)`,
      ),
    );
  } else if (
    workflow.limits?.budgetUsd !== undefined &&
    !driver.capabilities.price
  ) {
    // The run's budget caps each session too, and this driver spends unseen.
    refusals.push(
      refuse(
        `runs under the workflow's limits.budgetUsd, but driver \`${driver.id}\` does not report cost in dollars, so the budget can't be kept (a token budget comes with RFC-015)`,
      ),
    );
  }
  const servers =
    ("mcp" in node ? node.mcp : undefined) ?? workflow.defaults?.mcp ?? [];
  if (servers.length > 0 && !driver.capabilities.mcpServers) {
    refusals.push(
      refuse(
        `names MCP servers (\`mcp\`), but driver \`${driver.id}\` does not load a node's own MCP servers`,
      ),
    );
  }
  const ask = askOfTools(id, node, workflow);
  if (ask !== undefined && !driver.capabilities.questions) {
    refusals.push(
      refuse(
        `${ask}, but driver \`${driver.id}\` does not reach Ork's tools (ask_user, delegate, messages)`,
      ),
    );
  }
  return [...refusals, ...subagentRefusals(id, workflow, driver)];
};

/**
 * What stops each session node (or only `only`) from running on its driver: its
 * model's prefix, else `override` (`--driver`), else what the workflow names,
 * else `ready`. A node with no driver to check is left out; the run refuses
 * that on its own. An owner and a node it owns sharing a checkout on a
 * one-per-checkout driver are refused too: the owner's session holds the
 * checkout while the other waits.
 */
export const driverRefusals = (
  workflow: Workflow,
  drivers: readonly DriverNeeds[],
  choice: {
    override?: Driver | undefined;
    ready?: Driver | undefined;
    only?: string | undefined;
  },
): DriverRefusal[] => [
  ...Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (!SESSION_TYPES.has(node.type)) return [];
    if (choice.only !== undefined && choice.only !== id) return [];
    const driverId = nodeDriver(node, workflow, choice);
    const driver = drivers.find(d => d.id === driverId);
    return driver === undefined
      ? []
      : sessionRefusals(id, node, workflow, driver);
  }),
  ...driverQueues(workflow, drivers, choice).flatMap(
    ({ owner, nodes, message }) =>
      owner === undefined ||
      (choice.only !== undefined && !nodes.includes(choice.only))
        ? []
        : [{ node: owner, message }],
  ),
];
