/** @file Keeping conditions in step with the values they read (RFC-010). */

import { describe, expect, it } from "vitest";

import { applyEdits, type WorkflowEdit } from "../src/workflow-edit.ts";

const GATE = `schemaVersion: 1
name: t
nodes:
  g:
    type: human.gate
    question: ok?
    options: [approve, keep]
    recommended: keep
  ship:
    type: tool.shell
    command: x
  note:
    type: tool.shell
    command: y
edges:
  - from: g
    to: ship
    when: choice == 'approve' # the way on
  - from: g
    to: note
    when: choice == 'keep'
`;

const TOOL = `schemaVersion: 1
name: t
nodes:
  pr:
    type: tool.gh
    command: pr view
    output:
      format: json
      schema:
        state: [OPEN, CLOSED]
  r:
    type: control.router
  a:
    type: tool.shell
    command: x
edges:
  - pr -> r
  - { from: r, to: a, when: "json.state == 'OPEN'" }
`;

const edited = (text: string, edit: WorkflowEdit): string => {
  const result = applyEdits(text, [edit]);
  if (!result.ok) throw new Error(result.message);
  return result.text;
};

const refusal = (text: string, edit: WorkflowEdit): string => {
  const result = applyEdits(text, [edit]);
  return result.ok ? "not refused" : result.message;
};

describe("a gate's options", () => {
  it("follows a renamed option, and leaves the rest alone", () => {
    const text = edited(GATE, {
      op: "set",
      path: ["nodes", "g", "options"],
      value: ["go", "keep"],
    });
    expect(text).toContain("when: choice == 'go' # the way on");
    expect(text).toContain("when: choice == 'keep'");
    expect(text).toContain("recommended: keep");
  });

  it("follows into recommended, by one item's path too", () => {
    const text = edited(GATE, {
      op: "set",
      path: ["nodes", "g", "options", 1],
      value: "hold",
    });
    expect(text).toContain("when: choice == 'hold'");
    expect(text).toContain("recommended: hold");
  });

  it("refuses to remove an option an edge reads", () => {
    expect(
      refusal(GATE, { op: "delete", path: ["nodes", "g", "options", 0] }),
    ).toBe("The edge g -> ship reads approve. Change that condition first.");
  });

  it("adds one with nothing to follow", () => {
    const text = edited(GATE, {
      op: "set",
      path: ["nodes", "g", "options"],
      value: ["approve", "keep", "later"],
    });
    expect(text).toContain("when: choice == 'approve'");
  });
});

describe("a declared output's values", () => {
  it("follows a rename through a router", () => {
    const text = edited(TOOL, {
      op: "set",
      path: ["nodes", "pr", "output", "schema", "state"],
      value: ["MERGED", "CLOSED"],
    });
    expect(text).toContain("json.state == 'MERGED'");
  });

  it("refuses to remove a value or a field an edge reads", () => {
    expect(
      refusal(TOOL, {
        op: "set",
        path: ["nodes", "pr", "output", "schema", "state"],
        value: ["CLOSED"],
      }),
    ).toBe("The edge r -> a reads OPEN. Change that condition first.");
    expect(
      refusal(TOOL, {
        op: "delete",
        path: ["nodes", "pr", "output", "schema", "state"],
      }),
    ).toBe("The edge r -> a reads OPEN. Change that condition first.");
  });

  it("leaves a literal that's another field's alone", () => {
    const text = edited(
      TOOL.replace("json.state == 'OPEN'", "json.other == 'OPEN'"),
      {
        op: "set",
        path: ["nodes", "pr", "output", "schema", "state"],
        value: ["MERGED", "CLOSED"],
      },
    );
    expect(text).toContain("json.other == 'OPEN'");
  });
});
