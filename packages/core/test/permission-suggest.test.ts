/**
 * @file Tests for the `permission.suggest` signal (RFC-028 part 4): a shell
 *   rule allowed often enough across a project's runs is proposed once per run
 *   for the project's rules file, and never when it is covered, answered
 *   "always", or was never offered; `permission.denied` ignores the scoped
 *   allow answers.
 */

import { describe, expect, it } from "vitest";

import { permissionDecision } from "../src/control/permission-prompt.ts";
import {
  offeredRules,
  suggestedRules,
} from "../src/feedback/permission-suggest.ts";
import {
  allowsRule,
  createSignals,
  type DecisionRecord,
  type EventStore,
  type FeedbackReport,
  openStore,
  readShellLine,
  ruleFor,
  type RunEvent,
  type SignalOptions,
} from "../src/index.ts";

const FILE = "/p/.ork/project.yaml";
const LINE = "git log -1 --oneline";
const RULE = "Bash(git log *)";

/** The rules a prompt for `line` offers, as the permission tool computes them. */
const rulesOf = (line: string): string[] =>
  (readShellLine(line)?.commands ?? []).flatMap(command => {
    const rule = ruleFor(command);
    return rule === null ? [] : [rule];
  });

const storeWith = (runs: readonly string[]): EventStore => {
  const store = openStore(":memory:");
  for (const id of runs) {
    store.begin({ id, workflow: "w", file: "/p/w.ork.yaml", project: "/p" });
  }
  return store;
};

/** Opens and answers a permission decision; the events a run records for it. */
const answer = (
  store: EventStore,
  at: { runId: string; id: string },
  reply: string,
  options: { line?: string; scoped?: boolean; rules?: string[] } = {},
): RunEvent[] => {
  const line = options.line ?? LINE;
  const ask = {
    nodeId: "spec",
    toolName: "Bash",
    input: { command: line },
    rules: options.scoped === false ? [] : (options.rules ?? rulesOf(line)),
  };
  const record = store.openDecision({
    ...permissionDecision(ask, FILE),
    ...at,
  });
  store.answerDecision(at.id, reply, "terminal");
  return [
    {
      type: "decision.opened",
      node: "spec",
      decision: at.id,
      kind: "permission",
      question: record.question,
      options: record.options,
    },
    {
      type: "decision.answered",
      node: "spec",
      decision: at.id,
      answer: reply,
      by: "terminal",
    },
  ];
};

const stored = (store: EventStore, id: string): DecisionRecord => {
  const record = store.decision(id);
  if (record === undefined) throw new Error(`no decision ${id}`);
  return record;
};

const history = (
  store: EventStore,
  allow: readonly string[] = [],
): SignalOptions => ({
  permissions: {
    decisions: () => store.decisions({ project: "/p", status: "answered" }),
    allow,
    file: FILE,
  },
});

/** The feedback records `events` give through `observe`. */
const recorded = (
  observe: (event: RunEvent) => RunEvent[],
  events: readonly RunEvent[],
): FeedbackReport[] =>
  events
    .flatMap(event => observe(event))
    .flatMap(e => (e.type === "feedback.recorded" ? [e.feedback] : []));

/** The `permission.suggest` records `events` give through `observe`. */
const suggestions = (
  observe: (event: RunEvent) => RunEvent[],
  events: readonly RunEvent[],
): FeedbackReport[] =>
  recorded(observe, events).filter(f => f.code === "permission.suggest");

describe("permission.suggest", () => {
  it("proposes a rule allowed 3 times across 2 runs, once, with its file", () => {
    const store = storeWith(["r1", "r2"]);
    const first = createSignals(history(store));
    const early = suggestions(first, [
      ...answer(store, { runId: "r1", id: "d1" }, "allow"),
      ...answer(store, { runId: "r1", id: "d2" }, "allow-node"),
    ]);
    const second = createSignals(history(store));
    const late = suggestions(second, [
      ...answer(store, { runId: "r2", id: "d3" }, "allow-run"),
      ...answer(store, { runId: "r2", id: "d4" }, "allow"),
    ]);
    expect(early).toEqual([]);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      source: "system",
      code: "permission.suggest",
      target: "project",
      title: `Allow ${RULE} in the project's rules`,
      evidence: [RULE, FILE],
    });
  });

  it("needs two runs: three allows in one run propose nothing", () => {
    const store = storeWith(["r1"]);
    const signals = createSignals(history(store));
    const events = ["d1", "d2", "d3"].flatMap(id =>
      answer(store, { runId: "r1", id }, "allow"),
    );
    expect(suggestions(signals, events)).toEqual([]);
  });

  it("proposes nothing the project's allow rules already cover", () => {
    const store = storeWith(["r1", "r2"]);
    const signals = createSignals(history(store, ["Bash(git *)"]));
    const events = [
      ...answer(store, { runId: "r1", id: "d1" }, "allow"),
      ...answer(store, { runId: "r1", id: "d2" }, "allow"),
      ...answer(store, { runId: "r2", id: "d3" }, "allow"),
    ];
    expect(suggestions(signals, events)).toEqual([]);
  });

  it("proposes nothing once the rule was answered always", () => {
    const store = storeWith(["r1", "r2"]);
    const signals = createSignals(history(store));
    const events = [
      ...answer(store, { runId: "r1", id: "d0" }, "allow-always"),
      ...answer(store, { runId: "r1", id: "d1" }, "allow"),
      ...answer(store, { runId: "r2", id: "d2" }, "allow"),
      ...answer(store, { runId: "r2", id: "d3" }, "allow"),
    ];
    expect(suggestions(signals, events)).toEqual([]);
  });

  it("counts no prompt that offered no rule, and no deny", () => {
    const store = storeWith(["r1", "r2"]);
    const signals = createSignals(history(store));
    const events = [
      ...answer(store, { runId: "r1", id: "d1" }, "allow", { scoped: false }),
      ...answer(store, { runId: "r1", id: "d2" }, "deny"),
      ...answer(store, { runId: "r2", id: "d3" }, "allow", { scoped: false }),
      ...answer(store, { runId: "r2", id: "d4" }, "allow"),
    ];
    expect(suggestions(signals, events)).toEqual([]);
  });

  it("is recorded once per run however often it is allowed after", () => {
    const store = storeWith(["r1", "r2"]);
    answer(store, { runId: "r1", id: "d1" }, "allow");
    answer(store, { runId: "r1", id: "d2" }, "allow");
    const signals = createSignals(history(store));
    const events = ["d3", "d4", "d5"].flatMap(id =>
      answer(store, { runId: "r2", id }, "allow"),
    );
    expect(suggestions(signals, events)).toHaveLength(1);
  });

  it("is off without the project's history", () => {
    const store = storeWith(["r1", "r2"]);
    const signals = createSignals();
    const events = [
      ...answer(store, { runId: "r1", id: "d1" }, "allow"),
      ...answer(store, { runId: "r1", id: "d2" }, "allow"),
      ...answer(store, { runId: "r2", id: "d3" }, "allow"),
    ];
    expect(suggestions(signals, events)).toEqual([]);
  });

  it("takes only the uncovered commands' rules a prompt named", () => {
    const store = storeWith(["r1"]);
    answer(store, { runId: "r1", id: "d1" }, "allow", {
      line: `${LINE} | head -5`,
      rules: [RULE],
    });
    expect(rulesOf(`${LINE} | head -5`)).toHaveLength(2);
    expect(offeredRules(stored(store, "d1"))).toEqual([RULE]);
    expect(suggestedRules(store.decisions({ project: "/p" }), [])).toEqual([]);
  });
});

describe("permission.denied", () => {
  it("ignores every allow answer, scoped or not", () => {
    const store = storeWith(["r1"]);
    const signals = createSignals();
    const events = ["allow", "allow-node", "allow-run", "allow-always"].flatMap(
      (reply, index) =>
        answer(store, { runId: "r1", id: `d${String(index)}` }, reply),
    );
    expect(recorded(signals, events)).toEqual([]);
  });
});

describe("allowsRule", () => {
  it.each([
    [["Bash(git *)"], true],
    [["Bash"], true],
    [["Bash(*)"], true],
    [["Bash(git log *)"], true],
    [["Bash(git log:*)"], true],
    [["Bash(git log)"], false],
    [["Bash(git logs *)"], false],
    [["Bash(git log -1 *)"], false],
    [["Read(**)"], false],
    [[], false],
  ])("%j covers Bash(git log *): %s", (allow, expected) => {
    expect(allowsRule(allow, RULE)).toBe(expected);
  });
});
