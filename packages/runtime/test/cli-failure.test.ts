/**
 * @file Tests for what the CLI driver says when `claude` dies without a result:
 *   the last meaningful block of its stderr, capped and masked, and
 *   `interrupted` when a signal ended it or Ork asked it to stop.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { HumanChannel, RuntimeEvent, SessionSpec } from "@krapht/ork-core";
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

  it("ends a crash it can't read as driver_crashed", async () => {
    expect(await kindOf(stderrOf("Error: boom\n"))).toBe("driver_crashed");
  });

  it("reads a provider's words in stderr through the classifier", async () => {
    expect(
      await kindOf(stderrOf("Invalid API key · Please run /login\n")),
    ).toBe("auth");
  });
});
