/**
 * @file Regression tests for what a review of the builder's edits found: rename
 *   reads expressions rather than matching text, two edges between the same
 *   nodes stay apart, written-out edges keep what's in them, and lines nobody
 *   edited come back exactly as written.
 */

import { describe, expect, it } from "vitest";

import { applyEdits, readDocument, type WorkflowEdit } from "../src/index.ts";

const edited = (text: string, ...edits: WorkflowEdit[]): string => {
  const result = applyEdits(text, edits);
  if (!result.ok) throw new Error(result.message);
  return result.text;
};

const refusal = (text: string, ...edits: WorkflowEdit[]): string => {
  const result = applyEdits(text, edits);
  if (result.ok) throw new Error("It was not refused.");
  return result.message;
};

const NODES = `schemaVersion: 1
name: t
nodes:
  worker-2:
    type: tool.shell
    command: echo {{ nodes.worker-2.output.text }}
  other:
    type: tool.shell
    command: echo hi
`;

const rename = (from: string, to: string): WorkflowEdit => ({
  op: "renameNode",
  from,
  to,
});

const withCommand = (command: string): string =>
  `schemaVersion: 1
name: t
nodes:
  a:
    type: tool.shell
    command: ${JSON.stringify(command)}
`;

describe("renaming", () => {
  it("follows an id with a hyphen, as the builder makes", () => {
    expect(edited(NODES, rename("worker-2", "z"))).toContain(
      "{{ nodes.z.output.text }}",
    );
  });

  it("doesn't mistake a longer id for this one", () => {
    const text = withCommand(
      "{{ nodes.a-b.output.text }} {{ nodes.a.output }}",
    );
    expect(edited(text, rename("a", "z"))).toContain(
      "{{ nodes.a-b.output.text }} {{ nodes.z.output }}",
    );
  });

  it.each([
    ["{{ nodes['a'].output }}", "{{ nodes['z'].output }}"],
    ['{{ nodes["a"].output }}', '{{ nodes["z"].output }}'],
    ["{{ nodes . a.output }}", "{{ nodes . z.output }}"],
  ])("follows %s", (before, after) => {
    const written = edited(withCommand(before), rename("a", "z"));
    expect(readDocument(written)).toMatchObject({
      nodes: { z: { command: after } },
    });
  });

  it.each([
    "{{ inputs.nodes.a }}",
    "{{ x == 'nodes.a' }}",
    "nodes.a in plain text",
  ])("leaves %s", kept => {
    const written = edited(withCommand(kept), rename("a", "z"));
    expect(readDocument(written)).toMatchObject({
      nodes: { z: { command: kept } },
    });
  });

  it("changes only the reference in a template with a field of that name", () => {
    const written = edited(
      withCommand("{{ nodes.a.output.json.nodes.a }}"),
      rename("a", "z"),
    );
    expect(readDocument(written)).toMatchObject({
      nodes: { z: { command: "{{ nodes.z.output.json.nodes.a }}" } },
    });
  });

  it("reads a when as an expression, and only a real when", () => {
    const text = `schemaVersion: 1
name: t
nodes:
  a:
    type: mcp.call
    server: s
    tool: t
    arguments:
      when: nodes.a means something
  b:
    type: tool.shell
    command: x
edges:
  - from: a
    to: b
    when: nodes.a.output.status == 'nodes.a'
`;
    const written = edited(text, rename("a", "z"));
    expect(written).toContain("when: nodes.a means something");
    expect(written).toContain("when: nodes.z.output.status == 'nodes.a'");
  });

  it("refuses to follow an id through an anchor on something else", () => {
    const text = `schemaVersion: 1
name: t
description: &who a
nodes:
  a:
    type: agent.leader
  b:
    type: agent.worker
    parent: *who
`;
    expect(refusal(text, rename("a", "z"))).toContain("anchor");
  });
});

const PARALLEL = `schemaVersion: 1
name: t
nodes:
  a:
    type: tool.shell
    command: x
  b:
    type: tool.shell
    command: y
edges:
  - from: a
    to: b
    when: exitCode == 0
  - from: a
    to: b
    when: exitCode == 1
`;

describe("two edges between the same nodes", () => {
  it("changes only the one it names", () => {
    const written = edited(PARALLEL, {
      op: "setEdge",
      from: "a",
      to: "b",
      when: "exitCode == 2",
      whenWas: "exitCode == 1",
    });
    expect(written).toContain("when: exitCode == 0");
    expect(written).toContain("when: exitCode == 2");
    expect(written).not.toContain("when: exitCode == 1");
  });

  it("removes only the one it names", () => {
    const written = edited(PARALLEL, {
      op: "disconnect",
      from: "a",
      to: "b",
      whenWas: "exitCode == 0",
    });
    expect(written).not.toContain("when: exitCode == 0");
    expect(written).toContain("when: exitCode == 1");
  });

  it("refuses rather than guess, with no condition to tell them apart", () => {
    expect(
      refusal(PARALLEL, { op: "disconnect", from: "a", to: "b" }),
    ).toContain("2 edges");
  });
});

const EDGES = (edge: string): string => `schemaVersion: 1
name: t
nodes:
  a:
    type: tool.shell
    command: x
  b:
    type: tool.shell
    command: y
  c:
    type: tool.shell
    command: z
edges:
${edge}`;

describe("a written-out edge", () => {
  it("keeps its comments through a rename", () => {
    const text = EDGES("  - from: a # source\n    to: b # sink\n");
    expect(edited(text, rename("a", "z"))).toContain(
      "  - from: z # source\n    to: b # sink\n",
    );
  });

  it("keeps a list and its comments through a rename", () => {
    const text = EDGES("  - from: a\n    to:\n      - c # sink\n");
    expect(edited(text, rename("a", "z"))).toContain(
      "  - from: z\n    to:\n      - c # sink\n",
    );
  });

  it("keeps a field it doesn't know, and values of the wrong kind", () => {
    const text = EDGES(
      "  - from: [a, 7]\n    to: b\n    note: keep\n    when: 5\n",
    );
    const written = edited(text, rename("a", "z"));
    expect(written).toContain("note: keep");
    expect(written).toContain("when: 5");
    expect(readDocument(written)).toMatchObject({
      edges: [{ from: ["z", 7] }],
    });
  });

  it("keeps its comments when a node on one side is removed", () => {
    const text = EDGES(
      "  - from: [a, b] # both\n    to: c # sink\n    note: k\n",
    );
    const written = edited(text, { op: "removeNode", id: "b" });
    expect(written).toContain("# both");
    expect(written).toContain("# sink");
    expect(written).toContain("note: k");
  });

  it("keeps its comments when its condition changes", () => {
    const text = EDGES("  - from: a # source\n    to: b\n    when: x # why\n");
    const written = edited(text, {
      op: "setEdge",
      from: "a",
      to: "b",
      when: "y",
      whenWas: "x",
    });
    expect(written).toContain("from: a # source");
    expect(written).toContain("when: y # why");
  });

  it("stays written out when clearing its condition would lose a comment", () => {
    const text = EDGES("  - from: a # source\n    to: b\n    when: x\n");
    const written = edited(text, { op: "setEdge", from: "a", to: "b" });
    expect(written).toContain("from: a # source");
    expect(written).not.toContain("when:");
  });

  it("takes the short form once nothing needs the long one", () => {
    const text = EDGES("  - from: a\n    to: b\n    when: x\n");
    expect(edited(text, { op: "setEdge", from: "a", to: "b" })).toContain(
      "  - a -> b\n",
    );
  });
});

/** The first edit of a file: everything else in it should come back as it is. */
const touchingOnlyDescription = (text: string): string =>
  edited(text, { op: "set", path: ["description"], value: "new" });

const WITH_DESCRIPTION = (rest: string): string =>
  `schemaVersion: 1\nname: t\ndescription: old\ninputs:\n  x:\n    type: string\n${rest}`;

describe("lines nobody edited", () => {
  it.each([
    [
      "four spaces",
      "nodes:\n    a:\n        type: tool.shell\n        command: x\n",
    ],
    [
      "a list at its key's column",
      "nodes:\n  a:\n    type: tool.shell\n    command: x\nedges:\n- a -> a\n",
    ],
    [
      "padding before a value",
      "nodes:\n  a:\n    type:    tool.shell\n    command: x\n",
    ],
    [
      "a wrapped block",
      "nodes:\n  a:\n    type: tool.shell\n    command: >\n      one\n      two\n",
    ],
    [
      "wrapped plain text",
      "nodes:\n  a:\n    type: tool.shell\n    command: one\n      two\n",
    ],
    [
      "wrapped quoted text",
      'nodes:\n  a:\n    type: tool.shell\n    command: "one\n      two"\n',
    ],
    [
      "a number's own form",
      "nodes:\n  a:\n    type: tool.shell\n    command: x\n    timeout: 1e3\n",
    ],
    [
      "an escape",
      'nodes:\n  a:\n    type: tool.shell\n    command: "\\u00e9"\n',
    ],
    [
      "a comment beside a key",
      "nodes: # all of them\n  a:\n    type: tool.shell\n    command: x\n",
    ],
    [
      "a list across lines",
      "nodes:\n  a:\n    type: tool.shell\n    command: x\nedges: [\n  a -> a\n]\n",
    ],
    [
      "several blank lines",
      "nodes:\n\n\n  a:\n    type: tool.shell\n    command: x\n",
    ],
    ["no ending newline", "nodes:\n  a:\n    type: tool.shell\n    command: x"],
  ])("stay as written with %s", (_name, rest) => {
    expect(touchingOnlyDescription(WITH_DESCRIPTION(rest))).toBe(
      WITH_DESCRIPTION(rest).replace("description: old", "description: new"),
    );
  });

  it("stay as written in a file with Windows line endings", () => {
    const text = WITH_DESCRIPTION(
      "nodes:\n  a:\n    type: tool.shell\n    command: x\n",
    ).replaceAll("\n", "\r\n");
    expect(touchingOnlyDescription(text)).toBe(
      text.replace("description: old", "description: new"),
    );
  });

  it("fit a new field to a file's indent", () => {
    const text =
      "schemaVersion: 1\nname: t\nnodes:\n    a:\n        type: tool.shell\n        command: x\n";
    const written = edited(text, {
      op: "set",
      path: ["nodes", "a", "timeout"],
      value: "5m",
    });
    expect(written).toContain("        timeout: 5m\n");
    expect(written).toContain("    a:\n        type: tool.shell\n");
  });
});

describe("a file the merge can't reproduce", () => {
  it("is printed whole, with what it says intact", () => {
    const text = `schemaVersion: 1
name: t
nodes:
    a: # first
        type: tool.shell
        command: x
    b:
        type: tool.shell
        command: y
edges:
- a -> b
- b -> a
`;
    const written = edited(text, rename("a", "z"));
    expect(written).toContain("# first");
    expect(readDocument(written)).toMatchObject({
      nodes: { z: { command: "x" }, b: { command: "y" } },
      edges: ["z -> b", "b -> z"],
    });
  });
});

describe("removing and clearing", () => {
  it("keeps the next node's comment when this one ends with a comment", () => {
    const text = `schemaVersion: 1
name: t
nodes:
  a:
    type: tool.shell
    command: x
  b:
    type: tool.shell
    command: y
    # tail
  # about c
  c:
    type: tool.shell
    command: z
`;
    expect(edited(text, { op: "removeNode", id: "b" })).toContain("# about c");
  });

  it("leaves a node when its last field goes", () => {
    const text = `schemaVersion: 1
name: t
nodes:
  lead:
    type: agent.leader
  kid:
    parent: lead
`;
    expect(
      readDocument(edited(text, { op: "removeNode", id: "lead" })),
    ).toEqual({
      schemaVersion: 1,
      name: "t",
      nodes: { kid: {} },
    });
  });

  it("refuses a delete through an alias, rather than doing nothing", () => {
    const text = `schemaVersion: 1
name: t
defaults: &shared
  tools:
    allow: [Read]
limits: *shared
nodes: {}
`;
    expect(
      refusal(text, { op: "delete", path: ["limits", "tools", "allow"] }),
    ).toContain("anchor");
  });

  it("refuses a field of a node that isn't there", () => {
    expect(
      refusal(NODES, {
        op: "set",
        path: ["nodes", "ghost", "prompt"],
        value: "x",
      }),
    ).toContain("no node named ghost");
  });

  it("keeps the comment on an empty nodes list", () => {
    const text = "schemaVersion: 1\nname: t\nnodes: # none yet\n";
    expect(
      edited(text, {
        op: "addNode",
        id: "a",
        node: { type: "tool.shell", command: "x" },
      }),
    ).toContain("# none yet");
  });

  it("can deepen a list item added in the same batch", () => {
    const text = `schemaVersion: 1
name: t
nodes:
  a:
    type: tool.shell
    command: x
    notify: []
`;
    expect(
      readDocument(
        edited(
          text,
          { op: "set", path: ["nodes", "a", "notify", 0], value: { to: "a" } },
          { op: "set", path: ["nodes", "a", "notify", 0, "body"], value: "hi" },
        ),
      ),
    ).toMatchObject({ nodes: { a: { notify: [{ to: "a", body: "hi" }] } } });
  });

  it("keeps a key called __proto__", () => {
    const written = edited(NODES, {
      op: "set",
      path: ["nodes", "other", "plainEnv"],
      value: JSON.parse('{"__proto__": "x"}') as unknown,
    });
    expect(written).toContain("__proto__: x");
  });
});
