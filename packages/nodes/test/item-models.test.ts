/**
 * @file Tests for a fanned node's `model` and `effort` from its item
 *   (`{{item.model}}`): each item's session starts on its own model and effort,
 *   the run's events and usage show each item's model, and an item from `from:`
 *   with no effort level fails alone.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  compileWorkflow,
  type RunEvent,
  type SessionSpec,
  startRun,
  usageRowsOf,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/index.ts";

const usage = {
  costUsd: 0.5,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

/** A runtime that starts each session on the model it is asked for. */
const standIn = (fields: Record<string, unknown> = {}) => {
  const specs: SessionSpec[] = [];
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: spec => {
      specs.push(spec);
      const sessionId = `s${String(specs.length)}`;
      return {
        events: (async function* () {
          await Promise.resolve();
          yield {
            type: "session.started" as const,
            sessionId,
            model: spec.model ?? "default",
          };
          yield {
            type: "session.finished" as const,
            outcome: {
              subtype: "success" as const,
              sessionId,
              report: { status: "pass", summary: "ok", artifacts: {}, fields },
              text: "",
              usage,
              errors: [],
            },
          };
        })(),
        send: () => {},
        interrupt: () => Promise.resolve(),
      };
    },
  };
  return { runtime, specs };
};

/** Runs a workflow of these lines on the stand-in runtime. */
const run = async (lines: string[], fields?: Record<string, unknown>) => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "defaults: { model: haiku, isolation: shared }",
      ...lines,
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  const { runtime, specs } = standIn(fields);
  const events: RunEvent[] = [];
  const result = await startRun({
    graph,
    inputs: {},
    cwd: mkdtempSync(path.join(tmpdir(), "ork-item-models-")),
    executors: {
      "claude.worker": claudeExecutor({
        runtimeFor: () => Promise.resolve(runtime),
        readyDriver: "claude-code",
        inPlace: true,
      }),
    },
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: event => {
      events.push(event);
    },
  }).done;
  return { result, specs, events };
};

/** Each session's node and what it asked for. */
const asked = (specs: readonly SessionSpec[]) =>
  specs
    .map(({ nodeId, model, effort }) => ({ nodeId, model, effort }))
    .toSorted((a, b) => a.nodeId.localeCompare(b.nodeId));

const REVIEW = [
  "nodes:",
  "  review:",
  "    type: claude.worker",
  '    prompt: "Review for {{item.concern}}"',
  '    model: "{{item.model}}"',
  '    effort: "{{item.effort}}"',
  "    forEach:",
  "      items:",
  "        - { concern: correctness, model: opus, effort: high }",
  "        - { concern: tests, model: sonnet, effort: low }",
  '        - { concern: rules, model: "", effort: "" }',
];

describe("model and effort from {{item}}", () => {
  it("starts each item's session on its own model and effort, an empty one on the default", async () => {
    const { result, specs } = await run(REVIEW);
    expect(result.status).toBe("succeeded");
    expect(asked(specs)).toEqual([
      { nodeId: "review.0", model: "opus", effort: "high" },
      { nodeId: "review.1", model: "sonnet", effort: "low" },
      { nodeId: "review.2", model: "haiku", effort: undefined },
    ]);
  });

  it("shows each item's model in the run's events and in usage", async () => {
    const { events } = await run(REVIEW);
    const seen = events.map((event, seq) => ({ seq, at: "", event }));
    const rows = usageRowsOf({ id: "r", project: "/p", workflow: "t" }, seen);
    expect(
      rows
        .map(({ node, template, model }) => ({ node, template, model }))
        .toSorted((a, b) => a.node.localeCompare(b.node)),
    ).toEqual([
      { node: "review.0", template: "review", model: "opus" },
      { node: "review.1", template: "review", model: "sonnet" },
      { node: "review.2", template: "review", model: "haiku" },
    ]);
  });

  it("fails only the item from `from:` whose effort is no level, saying why", async () => {
    const { result, specs, events } = await run(
      [
        "nodes:",
        "  plan:",
        "    type: claude.worker",
        "    prompt: Plan",
        "    output:",
        "      schema: { tasks: { list: { name: string, effort: string } } }",
        "  build:",
        "    type: claude.worker",
        '    prompt: "Build {{item.name}}"',
        '    effort: "{{item.effort}}"',
        "    forEach:",
        '      from: "{{nodes.plan.output.tasks}}"',
        "      maxItems: 4",
        "edges:",
        "  - plan -> build",
      ],
      {
        tasks: [
          { name: "a", effort: "high" },
          { name: "b", effort: "hard" },
        ],
      },
    );
    expect(result.status).toBe("failed");
    expect(asked(specs).map(({ nodeId, effort }) => [nodeId, effort])).toEqual([
      ["build.0", "high"],
      ["plan", undefined],
    ]);
    expect(JSON.stringify(events)).toContain(
      "`effort: {{item.effort}}` gave `hard`, which is not an effort level (low, medium, high, xhigh, max)",
    );
  });
});
