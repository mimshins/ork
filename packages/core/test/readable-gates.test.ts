/**
 * @file Tests for what a gate shows a person: readable template values, and a
 *   decision's document in the store and queue (masked, on the record, never in
 *   an event), a permission's context as written, and the workflow filter.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  createDecisionQueue,
  type EventStore,
  type HumanChannel,
  type HumanQuestion,
  openStore,
  parseTemplate,
  pendingDecisions,
  renderBrief,
  renderTemplate,
  type RunEvent,
} from "../src/index.ts";
import { migrate, MIGRATIONS } from "../src/store/schema.ts";

const render = (value: unknown, source = "{{inputs.v}}"): string => {
  const template = parseTemplate(source);
  if (!template.ok) throw new Error(template.message);
  return renderTemplate(
    template.parts,
    { inputs: { v: value }, nodes: {} },
    { readable: true },
  );
};

describe("readable template values", () => {
  it.each([
    ["a string", "as written\n  kept", "as written\n  kept"],
    ["a number", 3, "3"],
    ["null", null, ""],
    ["undefined", undefined, ""],
    ["strings", ["a", "b"], "- a\n- b"],
    ["objects", { path: "x", n: 1 }, "path: x\nn: 1"],
    [
      "a list of objects",
      [
        { file: "a.ts", why: "new" },
        { file: "b.ts", why: "moved" },
      ],
      "- file: a.ts\n  why: new\n- file: b.ts\n  why: moved",
    ],
    ["a list in an object", { files: ["a", "b"] }, "files:\n  - a\n  - b"],
    ["a multi-line item", ["one\ntwo"], "- one\n  two"],
  ])("renders %s", (_name, value, expected) => {
    expect(render(value)).toBe(expected);
  });

  it("puts anything deeper than two levels in a pretty code block", () => {
    expect(render([{ a: { b: 1 } }], "Seen: {{inputs.v}}")).toBe(
      'Seen: \n\n    [\n      {\n        "a": {\n          "b": 1\n        }\n      }\n    ]',
    );
  });

  it("starts a code block with no blank lines when nothing comes before", () => {
    expect(render([{ a: { b: 1 } }]).startsWith("    [")).toBe(true);
  });

  it.each([
    [
      "a list after text",
      ["a", "b"],
      "Risks: {{inputs.v}}",
      "Risks: \n\n- a\n- b",
    ],
    [
      "an object after text",
      { k: 1 },
      "Risks: {{inputs.v}}",
      "Risks: \n\nk: 1",
    ],
    ["a list on its own line", ["a"], "Risks:\n{{inputs.v}}", "Risks:\n- a"],
    ["an empty list", [], "Risks: {{inputs.v}}", "Risks: "],
    ["a scalar", 3, "Risks: {{inputs.v}}", "Risks: 3"],
    ["a list after a value", ["a"], "{{inputs.v}}{{inputs.v}}", "- a\n\n- a"],
  ])("renders %s", (_name, value, source, expected) => {
    expect(render(value, source)).toBe(expected);
  });

  it("is off unless asked for, so prompts stay as ADR-047 has them", () => {
    const brief = renderBrief(
      "Read {{nodes.a.output.l}} and {{nodes.a.output.o}}",
      {},
      { a: { l: ["x", "y"], o: { k: 1 } } },
    );
    expect(brief).toMatchObject({ text: 'Read ["x","y"] and {"k":1}' });
  });
});

const SECRET = `sk-ant-${"x".repeat(24)}`;

const QUESTION = {
  nodeId: "gate",
  question: "Merge?",
  options: [{ id: "merge" }],
};

/** A store with a live run `r1`, and a queue for it whose answers never come. */
const queueOf = (local?: HumanChannel) => {
  const store: EventStore = openStore(":memory:");
  store.begin({ id: "r1", workflow: "feature", file: "/w", project: "/p" });
  const events: RunEvent[] = [];
  const queue = createDecisionQueue({
    store,
    runId: "r1",
    ...(local === undefined ? {} : { local }),
    emit: event => {
      events.push(event);
    },
    waitFor: () =>
      new Promise(() => {
        // Never answered: these tests read what was opened.
      }),
  });
  return { store, events, queue };
};

describe("a decision's document", () => {
  it("is stored masked and kept out of decision.opened", () => {
    const { store, events, queue } = queueOf();
    void queue.ask({ ...QUESTION, document: `Spec with ${SECRET}` });
    expect(store.decision("r1-1")?.document).toBe("Spec with [masked]");
    expect(events.map(event => event.type)).toEqual(["decision.opened"]);
    expect(events[0]).not.toHaveProperty("document");
    expect(JSON.stringify(events)).not.toContain("Spec with");
  });

  it("reaches the run's terminal masked, as the store holds it", () => {
    const seen: HumanQuestion[] = [];
    const { queue } = queueOf({
      ask: question => {
        seen.push(question);
        return Promise.resolve("merge");
      },
      permit: () => Promise.resolve({ allow: true }),
    });
    void queue.ask({
      ...QUESTION,
      question: `Merge ${SECRET}?`,
      context: `Context ${SECRET}`,
      document: `Spec with ${SECRET}`,
    });
    expect(seen).toMatchObject([
      {
        question: "Merge [masked]?",
        context: "Context [masked]",
        document: "Spec with [masked]",
      },
    ]);
  });

  it("gives the run's terminal no document key without one", () => {
    const seen: HumanQuestion[] = [];
    const { queue } = queueOf({
      ask: question => {
        seen.push(question);
        return Promise.resolve("merge");
      },
      permit: () => Promise.resolve({ allow: true }),
    });
    void queue.ask(QUESTION);
    expect(seen[0]).not.toHaveProperty("document");
    expect(seen[0]).not.toHaveProperty("context");
  });

  it("is no key at all on a decision without one", () => {
    const { store, queue } = queueOf();
    void queue.ask(QUESTION);
    expect(store.decision("r1-1")).not.toHaveProperty("document");
  });

  it("reads as none on a store from before documents, which still opens", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-document-"));
    const file = path.join(dir, "state.db");
    const db = new DatabaseSync(file);
    migrate(db, MIGRATIONS.slice(0, 17));
    db.exec(`INSERT INTO runs (id, workflow, file, project, status, pid, started_at)
      VALUES ('old', 'w', '/p/w', '/p', 'succeeded', 0, '2026-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO decisions (id, run_id, node, kind, question, options, opened_at, status)
      VALUES ('old-1', 'old', 'gate', 'question', 'Merge?', '[{"id":"merge"}]', '2026-01-01', 'open')`);
    db.close();
    const store = openStore(file);
    expect(store.decision("old-1")).toMatchObject({ question: "Merge?" });
    expect(store.decision("old-1")).not.toHaveProperty("document");
    store.close();
    rmSync(dir, { recursive: true });
  });
});

/** What a permission for `input` shows as the decision's context. */
const contextOf = (input: Record<string, unknown>): string | undefined => {
  const { store, queue } = queueOf();
  void queue.permit({ nodeId: "n", toolName: "Tool", input });
  return store.decision("r1-1")?.context;
};

describe("a permission's context", () => {
  it.each([
    ["a command", { command: "ls\n  -la" }, "ls\n  -la"],
    ["a path", { file_path: "/a/b", old: "x" }, "/a/b"],
    ["a url", { url: "https://x.dev" }, "https://x.dev"],
    ["a pattern", { pattern: "a.*" }, "a.*"],
    ["other input, pretty", { a: 1 }, '{\n  "a": 1\n}'],
  ])("shows %s as written", (_name, input, expected) => {
    expect(contextOf(input)).toBe(expected);
  });

  it("cuts at 4,000 characters, command or not", () => {
    expect(contextOf({ command: "x".repeat(4000) })).toBe("x".repeat(4000));
    expect(contextOf({ command: "x".repeat(4001) })).toBe(
      `${"x".repeat(3999)}…`,
    );
    expect(contextOf({ a: "x".repeat(5000) })).toHaveLength(4000);
  });
});

const open = (store: EventStore, runId: string): void => {
  store.openDecision({
    id: `${runId}-1`,
    runId,
    node: "gate",
    kind: "question",
    question: "Merge?",
    options: [{ id: "merge" }],
  });
};
const ids = (
  store: EventStore,
  filter: Parameters<typeof pendingDecisions>[1],
): string[] => pendingDecisions(store, filter).map(({ id }) => id);

describe("the workflow filter on open decisions", () => {
  it("keeps that workflow's runs, ANDed with the run", () => {
    const store = openStore(":memory:");
    store.begin({ id: "r1", workflow: "feature", file: "/a", project: "/p" });
    store.begin({ id: "r2", workflow: "other", file: "/b", project: "/p" });
    open(store, "r1");
    open(store, "r2");
    expect(ids(store, { workflow: "feature" })).toEqual(["r1-1"]);
    expect(ids(store, { workflow: "gone" })).toEqual([]);
    expect(ids(store, { workflow: "feature", runId: "r2" })).toEqual([]);
    expect(ids(store, {})).toEqual(["r1-1", "r2-1"]);
  });
});
