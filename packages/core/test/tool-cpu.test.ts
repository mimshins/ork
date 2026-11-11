/**
 * @file Tests for the CPU of Ork's tool commands: folded from `tool.result`
 *   events into the store as they are written (a spawned worker's under its
 *   template), and added up by node in a usage report.
 */

import { describe, expect, it } from "vitest";

import { openStore, type RunEvent, usageReport } from "../src/index.ts";

const result = (id: string, cpu?: { userMs: number; systemMs: number }) =>
  ({
    type: "node.event",
    id,
    event: {
      type: "tool.result",
      id,
      isError: false,
      ...(cpu === undefined ? {} : { cpu }),
    },
  }) satisfies RunEvent;

describe("tool commands' CPU", () => {
  it("is recorded as written, and reported by node", () => {
    const store = openStore(":memory:");
    store.begin({
      id: "r1",
      workflow: "w",
      file: "/p/w.ork.yaml",
      project: "/p",
    });
    store.append("r1", {
      type: "run.started",
      runId: "r1",
      workflow: "w",
      entries: ["check"],
      nodes: [
        { id: "check", type: "tool.shell" },
        { id: "implement", type: "claude.worker" },
      ],
    });
    store.append("r1", result("check", { userMs: 2000, systemMs: 500 }));
    store.append("r1", result("implement-1", { userMs: 1000, systemMs: 0 }));
    store.append("r1", result("check"));
    const rows = store.toolCpu({ project: "/p" });
    expect(rows).toMatchObject([
      { node: "check", userMs: 2000, systemMs: 500 },
      { node: "implement-1", template: "implement", userMs: 1000 },
    ]);
    const report = usageReport([], rows);
    expect(report.totals.cpuMs).toBe(3500);
    expect(report.groups.node.map(group => [group.key, group.cpuMs])).toEqual([
      ["w/check", 2500],
      ["w/implement", 1000],
    ]);
    expect(report.groups.model).toEqual([]);
    store.close();
  });
});
