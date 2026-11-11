/**
 * @file Where sessions on a driver that holds one session per checkout
 *   (`onePerCheckout`, RFC-014: Command Code's per-folder MCP entry) could wait
 *   for each other: session nodes that work in the same checkout and can run at
 *   once. Siblings only queue, so `ork validate` warns (`driver.queues`). An
 *   owner holds its checkout while it waits on the nodes it owns there, so that
 *   case would never finish: `driverRefusals` refuses it in validate and run.
 */

import type { AgentDriver } from "@krapht/ork-integrations";
import type { Driver, Node, Workflow } from "@krapht/ork-schema";

import { ancestorsOf, compileEdges } from "../graph/flow.ts";
import { nodeDriver } from "./driver.ts";

/** The part of a driver descriptor the queue check reads. */
export type QueueDriver = Pick<AgentDriver, "id" | "onePerCheckout">;

/** Session nodes that share one checkout and could run at once. */
export type CheckoutContention = {
  /** The node whose worktree it is, or `undefined` for the project checkout. */
  checkout: string | undefined;
  nodes: string[];
  /** One of them that owns another, so it holds the checkout while that waits. */
  owner: string | undefined;
};

export type DriverQueue = CheckoutContention & {
  driver: string;
  message: string;
};

const isSession = (node: Node): boolean =>
  node.type === "agent.leader" || node.type === "agent.worker";

const isolationOf = (node: Node, workflow: Workflow): string =>
  ("isolation" in node ? node.isolation : undefined) ??
  workflow.defaults?.isolation ??
  "worktree";

/**
 * Where a session works: the node whose worktree it uses, `null` for the
 * project checkout, `undefined` where it follows its input (`continue`, an
 * unowned `readonly`), which this check leaves out: it runs after that input.
 */
const checkoutOf = (
  workflow: Workflow,
  id: string,
): string | null | undefined => {
  let at = id;
  for (let i = 0; i <= Object.keys(workflow.nodes).length; i += 1) {
    const node = workflow.nodes[at];
    if (node === undefined) return undefined;
    const isolation = isolationOf(node, workflow);
    if (isolation === "worktree") return at;
    if (isolation === "continue") return undefined;
    if (node.parent === undefined) {
      return isolation === "readonly" ? undefined : null;
    }
    at = node.parent;
  }
  return undefined;
};

/** Whether `id` is owned, through any depth, by `above`. */
const ownedBy = (workflow: Workflow, id: string, above: string): boolean => {
  let at = workflow.nodes[id]?.parent;
  for (let i = 0; at !== undefined && i < 100; i += 1) {
    if (at === above) return true;
    at = workflow.nodes[at]?.parent;
  }
  return false;
};

/**
 * The session nodes of `include` that share a checkout with one they could run
 * beside.
 */
export const checkoutContention = (
  workflow: Workflow,
  include: (id: string) => boolean,
): CheckoutContention[] => {
  const { edges } = compileEdges(workflow);
  const before = new Map<string, Set<string>>();
  const ancestors = (id: string): Set<string> => {
    const known = before.get(id) ?? ancestorsOf(id, edges);
    before.set(id, known);
    return known;
  };
  const groups = new Map<string | null, string[]>();
  for (const [id, node] of Object.entries(workflow.nodes)) {
    if (!isSession(node) || !include(id)) continue;
    const checkout = checkoutOf(workflow, id);
    if (checkout === undefined) continue;
    groups.set(checkout, [...(groups.get(checkout) ?? []), id]);
  }
  const owns = (a: string, b: string): boolean => ownedBy(workflow, b, a);
  const found: CheckoutContention[] = [];
  for (const [checkout, ids] of groups) {
    const beside = (a: string, b: string): boolean =>
      owns(a, b) ||
      owns(b, a) ||
      (!ancestors(a).has(b) && !ancestors(b).has(a));
    const fanned = (id: string): boolean => {
      const node = workflow.nodes[id];
      return (
        node !== undefined &&
        "forEach" in node &&
        node.forEach !== undefined &&
        node.forEach.maxParallel !== 1
      );
    };
    // shortcut: `limits.concurrency: 1` is not read, so that workflow still warns.
    const nodes = ids.filter(
      a => fanned(a) || ids.some(b => b !== a && beside(a, b)),
    );
    if (nodes.length === 0) continue;
    found.push({
      checkout: checkout ?? undefined,
      nodes,
      owner: nodes.find(a => nodes.some(b => owns(a, b))),
    });
  }
  return found;
};

const messageOf = (driver: string, found: CheckoutContention): string => {
  const names = found.nodes.map(n => `\`${n}\``).join(", ");
  const where =
    found.checkout === undefined
      ? "the project checkout"
      : `the worktree of \`${found.checkout}\``;
  return found.owner === undefined
    ? `driver \`${driver}\` runs one session per checkout, but ${names} work in ${where} and could run at once: one session waits for the other. Give them separate worktrees (\`isolation: worktree\`), or run them on another driver.`
    : `node \`${found.owner}\` runs on driver \`${driver}\`, which runs one session per checkout, but ${names} work in ${where} and one owns another: the owner's session holds the checkout while the nodes it owns wait for it, so the run would never finish. Give each owned node its own worktree (\`isolation: worktree\`), or run them on another driver.`;
};

/**
 * The checkouts where sessions on a one-per-checkout driver could queue: the
 * driver each node takes is as for `driverRefusals` (its model's prefix, else
 * `override`, else what the workflow names, else `ready`).
 */
export const driverQueues = (
  workflow: Workflow,
  drivers: readonly QueueDriver[],
  choice: { override?: Driver | undefined; ready?: Driver | undefined },
): DriverQueue[] =>
  drivers
    .filter(driver => driver.onePerCheckout)
    .flatMap(driver =>
      checkoutContention(workflow, id => {
        const node = workflow.nodes[id];
        return (
          node !== undefined && nodeDriver(node, workflow, choice) === driver.id
        );
      }).map(found =>
        Object.assign({}, found, {
          driver: driver.id,
          message: messageOf(driver.id, found),
        }),
      ),
    );
