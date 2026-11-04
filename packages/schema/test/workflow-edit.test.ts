/**
 * @file Tests for the builder's document edits (RFC-008): a canonical file
 *   stays canonical, comments and style outside an edit stay, a rename follows
 *   every reference, shorthand edges split only when they must, and nothing is
 *   changed through a shared anchor.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  applyEdits,
  newWorkflowText,
  parseWorkflow,
  serializeWorkflow,
  type WorkflowEdit,
} from "../src/index.ts";

const example = (name: string): string =>
  readFileSync(
    new URL(`../../../examples/${name}.ork.yaml`, import.meta.url),
    "utf8",
  );

const EXAMPLES = [
  "across-projects",
  "checked-build",
  "pr-review",
  "software-factory",
];

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

/** Text the canonical serializer would write the same; invalid text fails. */
const canonical = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return serializeWorkflow(parsed.workflow);
};

const nodesOf = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const linesGone = (before: string, after: string): string[] => {
  const kept = new Set(after.split("\n"));
  return before.split("\n").filter(line => !kept.has(line));
};

const HAND = `# Our release flow. Owned by the platform team.
schemaVersion: 1
name: release
# keep this small: every run pays for it
defaults: { model: sonnet, budgetUsd: 2 } # cheap on purpose
nodes:
  # gathers what changed
  gather:
    type: tool.shell
    command: git log --oneline -20 # recent only
  build:
    type: claude.worker
    # the long part
    prompt: |
      Use {{nodes.gather.output.stdout}}.
      Not nodes.gather in prose, or {{nodes.gather-more.output.stdout}}.
    model: sonnet
    notify:
      - to: review # tell them
  review:
    type: claude.worker
    parent: build
    prompt: Look at it.
  # a person says yes
  ok:
    type: human.gate
    question: "Ship {{nodes.build.output.branch}}?"
    options: [yes, no]
  gather-more:
    type: tool.shell
    command: "true"
edges:
  - gather, gather-more -> build, review # first
  - { from: build, to: ok, when: "status == 'pass' && nodes.build.output.summary != ''" } # gate
messages:
  - between: [build, review]
outputs:
  branch: "{{nodes.build.output.branch}}"
`;

describe("a canonical file", () => {
  it.each(EXAMPLES)("%s stays canonical through node edits", name => {
    const start = example(name);
    const parsed = nodesOf(start);
    const [first = ""] = Object.keys(parsed.nodes);
    const text = edited(
      start,
      { op: "set", path: ["nodes", first, "description"], value: "Added." },
      { op: "set", path: ["description"], value: "Now described." },
      { op: "set", path: ["defaults", "practices", "caveman"], value: false },
      { op: "set", path: ["limits", "budgetUsd"], value: 3 },
      {
        op: "addNode",
        id: "added",
        node: { command: "echo hi", label: "Hi", type: "tool.shell" },
      },
      { op: "connect", from: first, to: "added" },
      { op: "connect", from: "added", to: first, when: "ok", maxRounds: 2 },
      { op: "renameNode", from: "added", to: "renamed" },
    );
    expect(canonical(text)).toBe(text);
    expect(nodesOf(text).nodes["renamed"]?.type).toBe("tool.shell");
  });

  it.each(EXAMPLES)("%s is unchanged when an edit changes nothing", name => {
    const start = example(name);
    const [first = ""] = Object.keys(nodesOf(start).nodes);
    expect(
      edited(start, {
        op: "set",
        path: ["nodes", first, "type"],
        value: nodesOf(start).nodes[first]?.type,
      }),
    ).toBe(start);
  });

  it("stays canonical when a multi-line prompt becomes one line, and back", () => {
    const start = canonical(HAND);
    const one = edited(start, {
      op: "set",
      path: ["nodes", "build", "prompt"],
      value: "One line.",
    });
    expect(canonical(one)).toBe(one);
    const two = edited(one, {
      op: "set",
      path: ["nodes", "build", "prompt"],
      value: "Two\nlines.\n",
    });
    expect(canonical(two)).toBe(two);
  });

  it("stays canonical when a removal takes edges and channels", () => {
    const start = canonical(HAND);
    const text = edited(
      start,
      { op: "removeNode", id: "review" },
      { op: "delete", path: ["nodes", "build", "notify"] },
    );
    expect(canonical(text)).toBe(text);
    expect(nodesOf(text).messages).toBeUndefined();
  });
});

describe("a hand-written file", () => {
  it("changes only the edited line when a value changes", () => {
    const text = edited(HAND, {
      op: "set",
      path: ["nodes", "build", "model"],
      value: "opus",
    });
    expect(linesGone(HAND, text)).toEqual(["    model: sonnet"]);
    expect(text).toContain("    model: opus");
  });

  it("keeps the spacing of lines nobody edited", () => {
    const start = HAND.replace(
      "-20 # recent only",
      "-20     # recent only",
    ).replace("options: [yes, no]", "options: [ yes,no ]");
    const text = edited(start, {
      op: "set",
      path: ["nodes", "build", "model"],
      value: "opus",
    });
    expect(linesGone(start, text)).toEqual(["    model: sonnet"]);
  });

  it("doesn't put back spacing that would change a value", () => {
    const start = `schemaVersion: 1
name: a
description: x [y
nodes: {}
`;
    const text = edited(start, {
      op: "set",
      path: ["description"],
      value: "x [ y",
    });
    expect(text).toContain("description: x [ y");
  });

  it("keeps a block prompt a block, with its comment", () => {
    const text = edited(HAND, {
      op: "set",
      path: ["nodes", "build", "prompt"],
      value: "Use it.\nAnd test it.\n",
    });
    expect(text).toContain("# the long part\n    prompt: |\n      Use it.\n");
  });

  it("keeps a flow map flow, and its comment, when a key is added", () => {
    const text = edited(HAND, {
      op: "set",
      path: ["defaults", "effort"],
      value: "high",
    });
    expect(text).toContain(
      "defaults: { model: sonnet, effort: high, budgetUsd: 2 } # cheap on purpose",
    );
  });

  it("removes a node with the comment above it, and nothing else", () => {
    const text = edited(HAND, { op: "removeNode", id: "ok" });
    expect(text).not.toContain("# a person says yes");
    expect(text).toContain("# gathers what changed");
    expect(text).toContain("# first");
  });

  it("doesn't pass the first node's comment to the next", () => {
    const text = edited(HAND, { op: "removeNode", id: "gather" });
    expect(text).not.toContain("# gathers what changed");
    expect(text).toContain("  build:");
  });

  it("frees what a removed node owned, and leaves a template for the checks", () => {
    const text = edited(HAND, { op: "removeNode", id: "build" });
    const workflow = nodesOf(text);
    expect(workflow.nodes["review"]?.parent).toBeUndefined();
    expect(workflow.messages).toBeUndefined();
    expect(text).toContain("Ship {{nodes.build.output.branch}}?");
  });

  it("keeps a field Ork doesn't know", () => {
    const start = HAND.replace("name: release", "name: release\nfuture: kept");
    const text = edited(start, {
      op: "set",
      path: ["nodes", "build", "model"],
      value: "opus",
    });
    expect(text).toContain("future: kept");
  });

  it("keeps a list item's comment when another item goes", () => {
    const start = `schemaVersion: 1
name: a
nodes:
  a:
    type: claude.worker
    skills:
      - first # one
      - second # two
      - third # three
`;
    const text = edited(start, {
      op: "set",
      path: ["nodes", "a", "skills"],
      value: ["first", "third"],
    });
    expect(text).toContain("- first # one\n      - third # three");
    expect(text).not.toContain("second");
  });
});

describe("renaming a node", () => {
  const text = edited(HAND, { op: "renameNode", from: "build", to: "make" });

  it("follows every reference", () => {
    const workflow = nodesOf(text);
    expect(workflow.nodes["review"]?.parent).toBe("make");
    expect(workflow.messages?.[0]?.between).toEqual(["make", "review"]);
    expect(workflow.outputs).toEqual({
      branch: "{{nodes.make.output.branch}}",
    });
    expect(text).toContain("Ship {{nodes.make.output.branch}}?");
    expect(text).toContain("gather, gather-more -> make, review # first");
    expect(text).toContain("nodes.make.output.summary != ''");
    expect(Object.keys(workflow.nodes)).toEqual([
      "gather",
      "make",
      "review",
      "ok",
      "gather-more",
    ]);
  });

  it("follows `notify:`", () => {
    const moved = edited(HAND, {
      op: "renameNode",
      from: "review",
      to: "check",
    });
    expect(moved).toContain("- to: check # tell them");
  });

  it("leaves prose and longer ids alone", () => {
    const moved = edited(HAND, {
      op: "renameNode",
      from: "gather",
      to: "collect",
    });
    expect(moved).toContain("Use {{nodes.collect.output.stdout}}.");
    expect(moved).toContain("Not nodes.gather in prose");
    expect(moved).toContain("{{nodes.gather-more.output.stdout}}");
  });

  it("refuses a taken or invalid id, or a node that isn't there", () => {
    expect(
      refusal(HAND, { op: "renameNode", from: "build", to: "ok" }),
    ).toContain("already a node");
    expect(
      refusal(HAND, { op: "renameNode", from: "build", to: "Not Valid" }),
    ).toContain("lowercase");
    expect(
      refusal(HAND, { op: "renameNode", from: "ghost", to: "real" }),
    ).toContain("no node");
  });
});

describe("edges", () => {
  const SHORT = HAND;

  it("connects with a new entry, leaving the rest", () => {
    const text = edited(SHORT, { op: "connect", from: "ok", to: "review" });
    expect(text).toContain("  - ok -> review\n");
    expect(linesGone(SHORT, text)).toEqual([]);
  });

  it("refuses an edge that exists", () => {
    expect(
      refusal(SHORT, { op: "connect", from: "gather", to: "review" }),
    ).toContain("already connected");
  });

  it("takes one target out of a shorthand entry, keeping its comment", () => {
    const start = SHORT.replace(
      "gather, gather-more -> build, review",
      "gather -> build, review",
    );
    const text = edited(start, {
      op: "disconnect",
      from: "gather",
      to: "review",
    });
    expect(text).toContain("  - gather -> build # first");
  });

  it("splits an entry only when both sides have several", () => {
    const text = edited(SHORT, {
      op: "disconnect",
      from: "gather",
      to: "review",
    });
    expect(text).toContain("  - gather-more -> build, review # first\n");
    expect(text).toContain("  - gather -> build\n");
  });

  it("removes a one-edge entry, and an empty list", () => {
    const start = `schemaVersion: 1
name: a
nodes:
  a: { type: tool.shell, command: "true" }
  b: { type: tool.shell, command: "true" }
edges:
  - a -> b
`;
    const text = edited(start, { op: "disconnect", from: "a", to: "b" });
    expect(text).not.toContain("edges");
  });

  it("sets a condition in place, and clears it back to shorthand", () => {
    const start = `schemaVersion: 1
name: a
nodes:
  a: { type: tool.shell, command: "true" }
  b: { type: tool.shell, command: "true" }
edges:
  - a -> b # keep me
`;
    const set = edited(start, {
      op: "setEdge",
      from: "a",
      to: "b",
      when: "ok",
    });
    expect(set).toContain("# keep me");
    expect(nodesOf(set).edges).toEqual([{ from: "a", to: "b", when: "ok" }]);
    const cleared = edited(set, { op: "setEdge", from: "a", to: "b" });
    expect(nodesOf(cleared).edges).toEqual(["a -> b"]);
    expect(cleared).toContain("# keep me");
  });

  it("splits a condition off a shorthand entry", () => {
    const text = edited(SHORT, {
      op: "setEdge",
      from: "gather",
      to: "build",
      when: "ok",
    });
    const { edges } = nodesOf(text);
    expect(edges).toContainEqual({ from: "gather", to: "build", when: "ok" });
    expect(edges).toContainEqual("gather-more -> build, review");
    expect(edges).toContainEqual("gather -> review");
  });

  it("refuses to change an edge that isn't there", () => {
    expect(
      refusal(SHORT, { op: "disconnect", from: "ok", to: "gather" }),
    ).toContain("no edge");
  });
});

describe("shared anchors", () => {
  const SHARED = `schemaVersion: 1
name: a
nodes:
  a: &base { type: tool.shell, command: "true" }
  b: *base
`;

  it("refuses an edit that would change another node", () => {
    expect(
      refusal(SHARED, {
        op: "set",
        path: ["nodes", "a", "command"],
        value: "false",
      }),
    ).toContain("shared through a YAML anchor");
    expect(
      refusal(SHARED, {
        op: "set",
        path: ["nodes", "b", "command"],
        value: "false",
      }),
    ).toContain("shared through a YAML anchor");
  });

  it("refuses to remove the node an alias reads", () => {
    expect(refusal(SHARED, { op: "removeNode", id: "a" })).toContain("anchor");
  });

  it("removes the alias, and allows what no alias reads", () => {
    const text = edited(SHARED, { op: "removeNode", id: "b" });
    expect(Object.keys(nodesOf(text).nodes)).toEqual(["a"]);
    expect(
      edited(text, {
        op: "set",
        path: ["nodes", "a", "command"],
        value: "false",
      }),
    ).toContain('command: "false"');
  });
});

describe("edits as a whole", () => {
  it("change nothing when one is refused", () => {
    const result = applyEdits(HAND, [
      { op: "set", path: ["nodes", "build", "model"], value: "opus" },
      { op: "removeNode", id: "ghost" },
    ]);
    expect(result).toEqual({
      ok: false,
      message: "There is no node named ghost.",
    });
  });

  it("refuse a file that doesn't parse", () => {
    expect(refusal("a: [", { op: "delete", path: ["a"] })).toContain(
      "doesn't parse",
    );
  });

  it("clear a map left empty, and keep `nodes`", () => {
    const start = `schemaVersion: 1
name: a
defaults:
  practices:
    caveman: false
nodes:
  a: { type: tool.shell, command: "true" }
`;
    const text = edited(start, {
      op: "delete",
      path: ["defaults", "practices", "caveman"],
    });
    expect(text).not.toContain("defaults");
    expect(edited(start, { op: "removeNode", id: "a" })).toContain("nodes: {}");
  });

  it("build a workflow from nothing, canonical at every valid step", () => {
    const start = newWorkflowText("fresh");
    expect(start).toContain("nodes: {}");
    const one = edited(start, {
      op: "addNode",
      id: "first",
      node: { type: "claude.worker", prompt: "Go." },
    });
    expect(canonical(one)).toBe(one);
    const two = edited(
      one,
      {
        op: "addNode",
        id: "second",
        node: {
          prompt: "Check.",
          verify: { command: "pnpm test" },
          type: "claude.worker",
        },
      },
      { op: "connect", from: "first", to: "second" },
    );
    expect(canonical(two)).toBe(two);
  });

  it("keep unfinished work editable, as a draft isn't valid yet", () => {
    const text = edited(newWorkflowText("fresh"), {
      op: "addNode",
      id: "gate",
      node: { type: "human.gate" },
    });
    expect(parseWorkflow(text).ok).toBe(false);
    expect(
      edited(text, {
        op: "set",
        path: ["nodes", "gate", "question"],
        value: "Ok?",
      }),
    ).toContain("question: Ok?");
  });
});
