/**
 * @file Tests for what the CLI driver says when `claude` dies without a result:
 *   the last meaningful block of its stderr, capped and masked, and
 *   `interrupted` when a signal ended it or Ork asked it to stop, also when it
 *   prints a result once stopped and hands in no report; a stop after a normal
 *   result keeps its end.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  HumanChannel,
  RuntimeEvent,
  SessionOutcome,
  SessionSpec,
} from "@krapht/ork-core";
import { afterAll, describe, expect, it } from "vitest";

import { createCliRuntime } from "../src/index.ts";

const dir = mkdtempSync(path.join(tmpdir(), "ork-cli-failure-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const spec: SessionSpec = {
  nodeId: "worker",
  cwd: process.cwd(),
  prompt: "Go",
  systemAppend: "# Ork",
  settingSources: [],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

let scripts = 0;

/** A stand-in for `claude` whose whole program is `body`. */
const fakeClaude = (body: string): string => {
  scripts += 1;
  const file = path.join(dir, `claude-${String(scripts)}.mjs`);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};

/** The kind a session that died with `body` ended as. */
const kindOf = async (body: string): Promise<string | undefined> => {
  const session = createCliRuntime({ bin: fakeClaude(body) }).start(spec, {
    human,
  });
  let kind: string | undefined;
  for await (const event of session.events) {
    if (event.type === "session.finished") kind = event.outcome.end?.kind;
  }
  return kind;
};

const reasonOf = (events: readonly RuntimeEvent[]): string => {
  const last = events.at(-1);
  if (last?.type !== "session.finished") throw new Error("no finish");
  return last.outcome.errors.join("\n");
};

/** The failure reason of a `claude` that runs `body` to its end. */
const failureOf = async (body: string): Promise<string> => {
  const session = createCliRuntime({ bin: fakeClaude(body) }).start(spec, {
    human,
  });
  const events: RuntimeEvent[] = [];
  for await (const event of session.events) events.push(event);
  return reasonOf(events);
};

/** The failure reason of a `claude` that Ork stops once it has started. */
const stoppedOf = async (body: string): Promise<string> => {
  const session = createCliRuntime({ bin: fakeClaude(body) }).start(spec, {
    human,
  });
  const events: RuntimeEvent[] = [];
  for await (const event of session.events) {
    events.push(event);
    if (event.type === "session.started") void session.interrupt();
  }
  return reasonOf(events);
};

const stderrOf = (text: string, code = 1): string =>
  `process.stderr.write(${JSON.stringify(text)}); process.exitCode = ${String(code)};`;

const STARTED = `console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/" }));`;

/** What the result Claude Code prints when stopped mid tool call spent. */
const EDE_USAGE = {
  costUsd: 0.5,
  inputTokens: 100,
  outputTokens: 20,
  turns: 3,
};

/** That result line (run b88b5fbb), printed by a fake's `body`. */
const edeResult = (extra: Record<string, unknown> = {}): string =>
  `console.log(${JSON.stringify(
    JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "s",
      errors: [
        "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
      ],
      total_cost_usd: EDE_USAGE.costUsd,
      num_turns: EDE_USAGE.turns,
      duration_ms: 100,
      usage: {
        input_tokens: EDE_USAGE.inputTokens,
        output_tokens: EDE_USAGE.outputTokens,
      },
      ...extra,
    }),
  )});`;

const EDE_RESULT = edeResult();

const FAILED_REPORT = { status: "fail", summary: "stopped", artifacts: {} };

/**
 * A fake that starts, then runs `then` and exits 1 on SIGINT. Its handler is
 * set before it says it started, since Ork stops it as soon as it reads that;
 * it ends by letting the loop drain, not `process.exit`, since a pipe's writes
 * are async on macOS and an exit at once could drop what `then` printed.
 */
const onSigint = (then: string): string =>
  `const alive = setInterval(() => {}, 1000); process.on("SIGINT", () => { ${then} process.exitCode = 1; clearInterval(alive); }); ${STARTED}`;

/** The outcome a fake running `body` ends with, `stop`ped once started. */
const endOf = async (body: string, stop: boolean): Promise<SessionOutcome> => {
  const session = createCliRuntime({ bin: fakeClaude(body) }).start(spec, {
    human,
  });
  let outcome: SessionOutcome | undefined;
  for await (const event of session.events) {
    if (stop && event.type === "session.started") void session.interrupt();
    if (event.type === "session.finished") outcome = event.outcome;
  }
  if (outcome === undefined) throw new Error("no finish");
  return outcome;
};

/** The end kinds of a fake running `body`, stopped once it has finished. */
const endsStoppedAfterFinish = async (body: string): Promise<string[]> => {
  const session = createCliRuntime({ bin: fakeClaude(body) }).start(spec, {
    human,
  });
  const kinds: string[] = [];
  for await (const event of session.events) {
    if (event.type !== "session.finished") continue;
    kinds.push(event.outcome.end?.kind ?? "none");
    void session.interrupt();
  }
  return kinds;
};

/** A normal result with a passing report, then the process stays alive. */
const DONE_THEN_ALIVE = `${STARTED} console.log(${JSON.stringify(
  JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "s",
    result: "done",
    structured_output: { status: "pass", summary: "ok", artifacts: {} },
    total_cost_usd: 0.01,
    num_turns: 1,
    duration_ms: 100,
    usage: { input_tokens: 10, output_tokens: 1 },
  }),
)}); setInterval(() => {}, 1000);`;

describe("a claude that dies without a result", () => {
  it("gives the error line, not the Node banner or the stack", async () => {
    const crash = [
      "/tmp/x.js:12",
      '    throw new Error("boom");',
      "    ^",
      "",
      "Error: connection lost",
      "    at foo (/tmp/x.js:12:5)",
      "    at node:internal/main:1:1",
      "",
      "Node.js v24.1.0",
      "",
    ].join("\n");
    expect(await failureOf(stderrOf(crash))).toBe("Error: connection lost");
  });

  it("says the exit code when stderr holds only the banner", async () => {
    expect(await failureOf(stderrOf("\nNode.js v24.1.0\n", 3))).toBe(
      "claude exited with code 3",
    );
  });

  it("keeps a block's lines on one line", async () => {
    expect(await failureOf(stderrOf("first\n\nsecond\n  third\n"))).toBe(
      "second third",
    );
  });

  it("does not copy an API key", async () => {
    const key = `sk-ant-api03-${"a".repeat(40)}`;
    const reason = await failureOf(stderrOf(`Error: refused for ${key}\n`));
    expect(reason).toBe("Error: refused for [masked]");
  });

  it("caps a long reason", async () => {
    const reason = await failureOf(stderrOf(`${"x".repeat(5000)}\n`));
    expect(reason.length).toBeLessThanOrEqual(500);
  });

  it("reads a line that came in two chunks whole", async () => {
    const body = `process.stderr.write("Error: sp"); await new Promise(r => setTimeout(r, 30)); process.stderr.write("lit\\n"); process.exitCode = 1;`;
    expect(await failureOf(body)).toBe("Error: split");
  });

  it("says interrupted when a signal ended it", async () => {
    expect(await failureOf(`process.kill(process.pid, "SIGKILL");`)).toBe(
      "interrupted",
    );
  });

  it("says interrupted when Ork stopped it, however it exits", async () => {
    const body = `${STARTED} process.on("SIGINT", () => { process.stderr.write("bye\\n"); process.exit(1); }); setInterval(() => {}, 1000);`;
    expect(await stoppedOf(body)).toBe("interrupted");
  });

  it("ends interrupted when Ork stopped it, whatever result it then prints", async () => {
    const outcome = await endOf(onSigint(EDE_RESULT), true);
    expect(outcome.end?.kind).toBe("interrupted");
    expect(outcome.end?.detail).toBeUndefined();
    expect(outcome.usage).toMatchObject(EDE_USAGE);
  });

  it("reads the same result unstopped as the tool's own end", async () => {
    const outcome = await endOf(`${STARTED} ${EDE_RESULT}`, false);
    expect(outcome.end?.kind).toBe("unknown");
  });

  it("keeps done when Ork stops it after it printed a normal result", async () => {
    expect(await endsStoppedAfterFinish(DONE_THEN_ALIVE)).toEqual(["done"]);
  });

  it("keeps the report of a stopped session that handed one in", async () => {
    const body = onSigint(edeResult({ structured_output: FAILED_REPORT }));
    const outcome = await endOf(body, true);
    expect(outcome.end?.kind).toBe("reported_failure");
  });

  it("ends a crash it can't read as driver_crashed", async () => {
    expect(await kindOf(stderrOf("Error: boom\n"))).toBe("driver_crashed");
  });

  it("reads a provider's words in stderr through the classifier", async () => {
    expect(
      await kindOf(stderrOf("Invalid API key · Please run /login\n")),
    ).toBe("auth");
  });
});
