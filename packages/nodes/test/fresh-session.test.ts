/**
 * @file Tests for the `sessions.freshOver` rule through the Claude executor: a
 *   delegated `session: resume` worker over the rule starts its next task in a
 *   new session whose prompt is its own prompt, the note of its earlier tasks
 *   and `## Task from`, and under the rule resumes with `## New task from`.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  compileWorkflow,
  type NodeExecutor,
  type SessionSpec,
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { claudeExecutor } from "../src/index.ts";

/** A runtime whose every session reports a context of `contextTokens`. */
const standIn = (contextTokens: number) => {
  const specs: SessionSpec[] = [];
  const runtime: AgentRuntime = {
    driver: "claude-code",
    start: spec => {
      specs.push(spec);
      const sessionId = spec.resume ?? `s${String(specs.length)}`;
      return {
        events: (async function* () {
          await Promise.resolve();
          yield { type: "session.started" as const, sessionId, model: "m" };
          yield {
            type: "session.finished" as const,
            outcome: {
              subtype: "success" as const,
              sessionId,
              report: {
                status: "pass",
                summary: "ok",
                artifacts: {},
                fields: {},
              },
              text: "",
              usage: {
                costUsd: 0,
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                turns: 1,
                durationMs: 1,
                contextTokens,
              },
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

/** A leader that delegates `fix` two tasks, one after the other. */
const lead: NodeExecutor = async context => {
  await context.ownership?.delegate([{ child: "fix", brief: "one" }]);
  await context.ownership?.delegate([{ child: "fix", brief: "two" }]);
  return { ok: true, output: { status: "pass", summary: "led" } };
};

/** `lead` delegates `fix` two tasks; `fix` runs on the stand-in runtime. */
const run = async (freshOver: string) => {
  const parsed = parseWorkflow(
    [
      "schemaVersion: 1",
      "name: t",
      "defaults: { model: haiku, isolation: shared }",
      `rules: { sessions: { freshOver: ${freshOver} } }`,
      "nodes:",
      "  lead: { type: agent.leader }",
      "  fix:",
      "    type: agent.worker",
      "    parent: lead",
      "    session: resume",
      "    prompt: You fix bugs.",
    ].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  const { runtime, specs } = standIn(150_000);
  const result = await startRun({
    graph,
    inputs: {},
    cwd: mkdtempSync(path.join(tmpdir(), "ork-fresh-session-")),
    executors: {
      "agent.leader": lead,
      "agent.worker": claudeExecutor({
        runtimeFor: () => Promise.resolve(runtime),
        readyDriver: "claude-code",
        inPlace: true,
      }),
    },
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    onEvent: () => {},
  }).done;
  return { result, second: specs[1] };
};

describe("a delegated builder's next task, through the executor", () => {
  it("starts over the rule in a new session with its own prompt and the task", async () => {
    const { result, second } = await run("100000");
    expect(result.status).toBe("succeeded");
    expect(second?.resume).toBeUndefined();
    expect(second?.prompt).toBe(
      [
        "You fix bugs.",
        "## Your earlier tasks in this run",
        "These tasks were done in an earlier session of yours that is not continued. Their work is in this checkout: read again what you need. Newest first:",
        "### one (pass)",
        "ok",
        "## Task from `lead`",
        "two",
      ].join("\n\n"),
    );
  });

  it("resumes under the rule with only the new task, and no note", async () => {
    const { second } = await run("200000");
    expect(second?.resume).toBe("s1");
    expect(second?.prompt).toBe(
      "## New task from `lead`\n\ntwo\n\nEnd with a new structured report.",
    );
    expect(second?.prompt).not.toContain("## Your earlier tasks");
  });
});
