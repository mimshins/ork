/** @file What each node can say (RFC-010). */

import { type Node, NodeSchema } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { nodeSays } from "../src/graph/says.ts";
import { REPORT_STATUSES } from "../src/graph/types.ts";

const node = (value: unknown): Node => NodeSchema.parse(value);

const NODES = {
  claude: node({
    type: "claude.worker",
    output: { schema: { verdict: ["approve", "escalate"], n: "integer" } },
  }),
  narrow: node({
    type: "claude.worker",
    output: { schema: { status: ["pass"] } },
  }),
  tool: node({
    type: "tool.shell",
    command: "x",
    output: { format: "json", schema: { state: ["OPEN"], on: "boolean" } },
  }),
  plain: node({ type: "tool.shell", command: "x" }),
  mcp: node({ type: "mcp.call", server: "s", tool: "t" }),
  gate: node({
    type: "human.gate",
    question: "q",
    options: ["yes", { id: "no", label: "No" }],
  }),
  call: node({ type: "workflow.call", workflow: "w" }),
  router: node({ type: "control.router" }),
  split: node({ type: "control.split" }),
  many: node({ type: "control.router" }),
  looped: node({ type: "control.router" }),
  join: node({ type: "control.join" }),
};

const LINKS = [
  { from: "claude", to: "router" },
  { from: "router", to: "split" },
  { from: "claude", to: "many" },
  { from: "tool", to: "many" },
  { from: "claude", to: "join" },
  { from: "call", to: "join" },
  { from: "gate", to: "looped", maxRounds: 3 },
  { from: "claude", to: "looped" },
];

describe("nodeSays", () => {
  const says = nodeSays(NODES, LINKS);

  it("gives a Claude node's closed status and its declared fields", () => {
    expect(says["claude"]).toEqual({
      fields: [
        { field: "status", kind: "values", values: REPORT_STATUSES },
        { field: "summary", kind: "text" },
        { field: "verdict", kind: "values", values: ["approve", "escalate"] },
        { field: "n", kind: "number" },
      ],
      canFail: true,
      canDeclare: false,
    });
  });

  it("lets a node's own list narrow its status", () => {
    expect(says["narrow"]?.fields).toContainEqual({
      field: "status",
      kind: "values",
      // A session with no good report fails, whatever is declared.
      values: ["pass", "fail"],
    });
    expect(
      says["narrow"]?.fields.filter(({ field }) => field === "status"),
    ).toHaveLength(1);
  });

  it("leaves a list open if a value on it can't be compared", () => {
    const allowsNull = nodeSays(
      {
        a: node({
          type: "claude.worker",
          output: { schema: { verdict: ["yes", null] } },
        }),
      },
      [],
    );
    expect(allowsNull["a"]?.fields).toContainEqual({
      field: "verdict",
      kind: "values",
      values: ["yes"],
      open: true,
    });
  });

  it("reads a tool's JSON through its declaration", () => {
    expect(says["tool"]).toMatchObject({ canFail: true, canDeclare: true });
    expect(says["tool"]?.fields).toContainEqual({
      field: "json.state",
      kind: "values",
      values: ["OPEN"],
    });
    expect(says["tool"]?.fields).toContainEqual({
      field: "json.on",
      kind: "boolean",
    });
    expect(says["plain"]?.canDeclare).toBe(false);
    expect(says["mcp"]?.canDeclare).toBe(true);
  });

  it("gives a gate's options, plain or with ids", () => {
    expect(says["gate"]).toEqual({
      fields: [{ field: "choice", kind: "values", values: ["yes", "no"] }],
      canFail: false,
      canDeclare: false,
    });
  });

  it("reads through a router or split", () => {
    expect(says["router"]?.fields).toEqual(says["claude"]?.fields);
    expect(says["split"]?.fields).toEqual(says["claude"]?.fields);
    expect(says["router"]).toMatchObject({ canFail: false, canDeclare: false });
  });

  it("can't know a pass-through with several inputs", () => {
    expect(says["many"]?.fields).toEqual([]);
  });

  it("reads joins that feed each other in a moment, not once per way", () => {
    const stages = Array.from({ length: 40 }, (_, at) => String(at));
    const nodes = Object.fromEntries(
      stages.flatMap(at => [
        [`j${at}`, node({ type: "control.join" })],
        [`a${at}`, node({ type: "control.router" })],
        [`b${at}`, node({ type: "control.router" })],
      ]),
    );
    const links = stages.flatMap((at, index) => [
      { from: `j${at}`, to: `a${at}` },
      { from: `j${at}`, to: `b${at}` },
      { from: `a${at}`, to: `j${String(index + 1)}` },
      { from: `b${at}`, to: `j${String(index + 1)}` },
    ]);
    expect(Object.keys(nodeSays(nodes, links))).toHaveLength(120);
  }, 2000);

  it("counts a loop back as one of them, as it brings its own output", () => {
    expect(says["looped"]?.fields).toEqual([]);
  });

  it("gathers a join's statuses from its inputs", () => {
    expect(says["join"]?.fields).toEqual([
      {
        field: "statuses",
        kind: "statuses",
        values: [...REPORT_STATUSES],
        // A call's status depends on what it called.
        open: true,
      },
      { field: "count", kind: "number" },
    ]);
  });

  it("knows a join's statuses when every input has a list", () => {
    const closed = nodeSays(
      { a: NODES.claude, b: NODES.narrow, join: NODES.join },
      [
        { from: "a", to: "join" },
        { from: "b", to: "join" },
      ],
    );
    expect(closed["join"]?.fields[0]).toEqual({
      field: "statuses",
      kind: "statuses",
      values: [...REPORT_STATUSES],
    });
  });

  it("says the same whichever node it's asked about first", () => {
    const links = [
      { from: "a", to: "j" },
      { from: "r", to: "j" },
      { from: "j", to: "r", maxRounds: 2 },
    ];
    const a = node({ type: "claude.worker", prompt: "x" });
    const j = node({ type: "control.join" });
    const r = node({ type: "control.router" });
    const fieldsOfR = (nodes: Record<string, Node>) =>
      nodeSays(nodes, links)["r"]?.fields.map(({ field }) => field);
    expect(fieldsOfR({ a, j, r })).toEqual(fieldsOfR({ a, r, j }));
  });

  it("gives up on a loop of pass-throughs", () => {
    const loop = nodeSays(
      {
        a: node({ type: "control.router" }),
        b: node({ type: "control.split" }),
      },
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(loop["a"]?.fields).toEqual([]);
  });
});
