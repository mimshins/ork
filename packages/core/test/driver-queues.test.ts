/**
 * @file Tests for the one-session-per-checkout check (RFC-014): sessions on a
 *   driver that declares `onePerCheckout` which work in the same checkout and
 *   can run at once, and an owner that would hold its checkout from the nodes
 *   it owns. Descriptors are fakes.
 */

import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { driverQueues, type QueueDriver } from "../src/index.ts";

const ONE: QueueDriver = { id: "command-code", onePerCheckout: true };
const MANY: QueueDriver = { id: "claude-code", onePerCheckout: false };

const workflowOf = (body: string): Workflow => {
  const parsed = parseWorkflow(`schemaVersion: 1\nname: t\n${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const worker = (id: string, extra = ""): string =>
  `  ${id}:\n    type: agent.worker\n    prompt: go\n${extra}`;

const queues = (workflow: Workflow, drivers = [ONE, MANY]) =>
  driverQueues(workflow, drivers, { override: "command-code" });

const fan = (extra: string) =>
  workflowOf(
    `nodes:\n${worker("a", `    isolation: shared\n    forEach:\n      items: [1, 2]\n${extra}`)}`,
  );

describe("sessions that could queue per checkout", () => {
  it("warns for siblings sharing the project checkout, naming driver and nodes", () => {
    const w = workflowOf(
      `nodes:\n${worker("a", "    isolation: shared\n")}${worker("b", "    isolation: shared\n")}`,
    );
    const [only, ...rest] = queues(w);
    expect(rest).toEqual([]);
    expect(only?.nodes).toEqual(["a", "b"]);
    expect(only?.message).toContain("driver `command-code`");
    expect(only?.message).toContain("`a`, `b`");
    expect(only?.message).toContain("isolation: worktree");
  });

  it("does not warn for worktrees, ordered nodes or a driver that allows many", () => {
    const apart = workflowOf(`nodes:\n${worker("a")}${worker("b")}`);
    expect(queues(apart)).toEqual([]);
    const ordered = workflowOf(
      `nodes:\n${worker("a", "    isolation: shared\n")}${worker("b", "    isolation: shared\n")}edges:\n  - a -> b\n`,
    );
    expect(queues(ordered)).toEqual([]);
    const shared = workflowOf(
      `nodes:\n${worker("a", "    isolation: shared\n")}${worker("b", "    isolation: shared\n")}`,
    );
    expect(queues(shared, [MANY])).toEqual([]);
  });

  it("warns for a fan-out in one checkout, unless it runs one at a time", () => {
    expect(queues(fan(""))).toHaveLength(1);
    expect(queues(fan("      maxParallel: 1\n"))).toEqual([]);
  });

  it("names the owner that holds the checkout its shared worker waits in", () => {
    const w = workflowOf(
      `nodes:\n  lead:\n    type: agent.leader\n    prompt: go\n${worker("w", "    parent: lead\n    isolation: shared\n")}`,
    );
    const [only] = queues(w);
    expect(only?.nodes).toEqual(["lead", "w"]);
    expect(only?.owner).toBe("lead");
    expect(only?.message).toContain(
      "node `lead` runs on driver `command-code`",
    );
    expect(only?.message).toContain("worktree of `lead`");
    expect(only?.message).toContain("never finish");
  });

  it("names no owner for siblings, who only wait", () => {
    const w = workflowOf(
      `nodes:\n${worker("a", "    isolation: shared\n")}${worker("b", "    isolation: shared\n")}`,
    );
    expect(queues(w).map(found => found.owner)).toEqual([undefined]);
  });

  it("checks each node against its own driver", () => {
    const w = workflowOf(
      `nodes:\n${worker("a", "    isolation: shared\n    driver: command-code\n")}${worker("b", "    isolation: shared\n    driver: claude-code\n")}`,
    );
    expect(driverQueues(w, [ONE, MANY], {})).toEqual([]);
  });
});
