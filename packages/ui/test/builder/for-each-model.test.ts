/**
 * @file What the builder means by `forEach` (RFC-013): the lists a node may
 *   read, what a change of kind keeps, a new list's item fields, where
 *   `{{item}}` is offered, and a list left out of every condition (L208).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { draftGraph } from "@krapht/ork-server";
import { describe, expect, it } from "vitest";

import {
  firstRow,
  saysOf,
  shownCondition,
} from "../../src/builder/condition-model.ts";
import {
  eachKindOf,
  holdersOf,
  itemHint,
  listsBefore,
  readItemFields,
  wholeNumber,
  withEachKind,
} from "../../src/builder/for-each-model.ts";
import type { JsonSchema } from "../../src/builder/schema-model.ts";

const graphOf = (edges: string) =>
  draftGraph(`schemaVersion: 1
name: t
nodes:
  plan:
    type: agent.worker
    output:
      schema:
        verdict: [pass, fail]
        tasks: { list: { title: string, files: number } }
  scan:
    type: tool.shell
    command: x
    output:
      format: json
      schema:
        paths: { list: {} }
  late:
    type: agent.worker
    output:
      schema:
        later: { list: {} }
  build:
    type: agent.worker
    forEach: { from: "{{nodes.plan.output.tasks}}", maxItems: 5 }
edges:
${edges}
`).graph;

const EDGES = `  - plan -> build
  - scan -> plan
  - build -> late
  - { from: late, to: plan, when: "true", maxRounds: 2 }`;

describe("listsBefore", () => {
  it("offers only the list fields of nodes that run before, as templates", () => {
    expect(listsBefore(graphOf(EDGES), "build").map(l => l.template)).toEqual([
      "{{nodes.plan.output.tasks}}",
      "{{nodes.scan.output.json.paths}}",
    ]);
  });

  it("offers a fanned node's gathered lists and not its statuses", () => {
    const fields = listsBefore(graphOf(EDGES), "late").map(l => l.field);
    expect(fields).toContain("results");
    expect(fields).not.toContain("statuses");
  });

  it("offers nothing from a node that only loops back", () => {
    expect(listsBefore(graphOf(EDGES), "plan").map(l => l.node)).toEqual([
      "scan",
    ]);
  });
});

describe("the kind of fan-out", () => {
  it("reads the kind from the keys", () => {
    expect(eachKindOf(null)).toBe("once");
    expect(eachKindOf({ items: [1] })).toBe("items");
    expect(eachKindOf({ from: "", maxItems: 1 })).toBe("from");
  });

  it("keeps what both kinds share and drops the rest", () => {
    const own = { from: "x", maxItems: 4, maxParallel: 2, onFailure: "stop" };
    expect(withEachKind(own, "items")).toEqual({
      items: [""],
      maxParallel: 2,
      onFailure: "stop",
    });
    expect(withEachKind({ items: [1] }, "from")).toEqual({
      from: "",
      maxItems: 10,
    });
    expect(withEachKind(own, "once")).toBeUndefined();
  });

  it("takes a whole number above 0 and nothing else", () => {
    expect(
      [" 3 ", "0", "-1", "1.5", "", "x"].map(typed => wholeNumber(typed)),
    ).toEqual([3, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("item fields", () => {
  it("reads names and types, a bare name being a string", () => {
    expect(readItemFields("title, files:number")).toEqual({
      shape: { title: "string", files: "number" },
      problems: [],
    });
    expect(readItemFields("")).toEqual({ shape: {}, problems: [] });
  });

  it("says what an entry gets wrong", () => {
    expect(readItemFields("files:list, title, title").problems).toEqual([
      "`files:list` isn't a type. Use string, number, integer or boolean.",
      "`title` is listed twice.",
    ]);
  });
});

describe("itemHint", () => {
  const graph = graphOf(EDGES);
  const path = ["nodes", "build", "prompt"] as const;
  const from = { from: "{{nodes.plan.output.tasks}}", maxItems: 5 };

  it("adds the item fields the list's shape gives", () => {
    expect(itemHint(graph, path, from, "Ask.")).toBe(
      "Ask. Reads `{{item}}` and `{{index}}`, and `{{item.title}}`, `{{item.files}}`.",
    );
  });

  it("names only item and index when nothing says what an item has", () => {
    expect(itemHint(graph, path, { from: "", maxItems: 1 })).toBe(
      "Reads `{{item}}` and `{{index}}`.",
    );
  });

  it("uses the keys a written list's entries share", () => {
    const items = [{ a: 1, b: 2 }, { a: 3 }];
    expect(itemHint(graph, path, { items })).toContain("`{{item.a}}`");
    expect(itemHint(graph, path, { items })).not.toContain("item.b");
  });

  it("says nothing on a node that is not fanned, or of a field that can't read it", () => {
    expect(itemHint(graph, path, undefined, "Ask.")).toBe("Ask.");
    expect(
      itemHint(graph, ["nodes", "build", "instructions"], from, "Be."),
    ).toBe("Be.");
  });
});

describe("a list in a condition (L208)", () => {
  const graph = graphOf(EDGES);

  it("never starts a test on a list", () => {
    const says = saysOf(graph, "plan");
    expect(says.fields.some(({ items }) => items !== undefined)).toBe(true);
    expect(firstRow(says)?.field).toBe("status");
    expect(
      firstRow({
        fields: [
          { field: "tasks", kind: "text", items: [] },
          { field: "count", kind: "number" },
        ],
        canFail: false,
        canDeclare: false,
      })?.field,
    ).toBe("count");
  });

  it("shows a test that reads a list as typed text", () => {
    const shown = shownCondition(
      {
        condition: {
          mode: "test",
          join: "all",
          rows: [{ field: "tasks", test: "contains", value: "x" }],
        },
        when: "tasks contains 'x'",
      },
      saysOf(graph, "plan"),
    );
    expect(shown).toEqual({ mode: "hand", text: "tasks contains 'x'" });
  });

  it("keeps a fanned node's statuses and count", () => {
    const fields = saysOf(graph, "build").fields.map(({ field }) => field);
    expect(fields).toEqual(["items", "results", "statuses", "count"]);
    expect(firstRow(saysOf(graph, "build"))?.field).toBe("statuses");
  });
});

const isRecord = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null;

const holderIds = (text: string, id: string): string[] =>
  holdersOf(draftGraph(text).graph, SCHEMA, id).map(h => h.id);

const parsed: unknown = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../schema/workflow.schema.json"),
    "utf8",
  ),
);
const SCHEMA: JsonSchema = isRecord(parsed) ? parsed : {};

const FLOW = (nodes: string, edges: string): string =>
  `schemaVersion: 1\nname: t\nnodes:\n${nodes}edges:\n${edges}`;

const WORKER = (id: string, extra = ""): string =>
  `  ${id}:\n    type: agent.worker\n${extra}`;

describe("holdersOf", () => {
  it("does not offer a node that only loops back into this one", () => {
    const text = FLOW(
      WORKER("build") + WORKER("review"),
      '  - build -> review\n  - { from: review, to: build, when: "true", maxRounds: 2 }\n',
    );
    expect(holderIds(text, "build")).toEqual([]);
  });

  it("offers a node that runs before through others, with no list yet", () => {
    const text = FLOW(
      WORKER("plan") + "  split:\n    type: control.split\n" + WORKER("build"),
      "  - plan -> split\n  - split -> build\n",
    );
    expect(holderIds(text, "build")).toEqual(["plan"]);
  });

  it("does not offer a fanned node, whose output is its items' results", () => {
    const text = FLOW(
      WORKER("a", "    forEach: { items: [x, y] }\n") + WORKER("build"),
      "  - a -> build\n",
    );
    expect(holderIds(text, "build")).toEqual([]);
  });
});

describe("readItemFields", () => {
  it("treats names like toString as ordinary, and keeps __proto__", () => {
    const { shape, problems } = readItemFields(
      "constructor, toString:number, __proto__:boolean",
    );
    expect(problems).toEqual([]);
    expect(Object.keys(shape)).toEqual([
      "constructor",
      "toString",
      "__proto__",
    ]);
    expect(readItemFields("a, a").problems).toEqual(["`a` is listed twice."]);
  });
});
