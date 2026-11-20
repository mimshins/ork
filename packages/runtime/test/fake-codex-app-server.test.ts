/**
 * @file Whole `codex-app-server` sessions through the session runner on the
 *   fake `codex app-server` (`fixtures/fake-codex-app-server.mjs`): a first
 *   prompt, an approval Ork's `permit` answers, a message steered mid-turn, a
 *   stop, and a resume by thread id; Ork's token only in the process
 *   environment, never in a frame; the canary ending a leg whose tools ran
 *   without the hook; and the fence refusing a leg whose Codex loads a hook Ork
 *   did not pass, before any thread.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  HumanChannel,
  RuntimeEvent,
  Session,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createCodexAppServerAdapter,
  createSessionRuntime,
  HOOK_DID_NOT_RUN,
} from "../src/index.ts";
import { collect, outcomeOf } from "./contract/harness.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-codex-app-server.mjs", import.meta.url),
);

const temp = (prefix: string): string =>
  mkdtempSync(path.join(tmpdir(), prefix));

const RecordSchema = z.looseObject({
  kind: z.string(),
  args: z.array(z.string()).optional(),
  token: z.string().optional(),
  decision: z.string().optional(),
  frame: z
    .looseObject({
      method: z.string().optional(),
      params: z.unknown().optional(),
    })
    .optional(),
});

/** What Ork's human channel was asked to permit, in order. */
type Permits = { toolName: string; input: unknown }[];

const humanOf = (permits: Permits, allow: boolean): HumanChannel => ({
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: request => {
    permits.push({ toolName: request.toolName, input: request.input });
    return Promise.resolve({ allow, message: allow ? "" : "no" });
  },
});

/**
 * A session runtime on the fake, playing `scenario`, with its legs' frames
 * recorded; `start` starts a session in one folder, so a resume finds it.
 */
const fake = (scenario: string, env: Record<string, string> = {}) => {
  const root = temp("ork-cas-root-");
  const cwd = temp("ork-cas-cwd-");
  const record = path.join(temp("ork-cas-record-"), "legs.jsonl");
  const permits: Permits = [];
  const runtime = createSessionRuntime(
    createCodexAppServerAdapter({
      secretRoot: root,
      systemHooks: path.join(root, "none.json"),
    }),
    {
      bin: FAKE,
      env: {
        ...process.env,
        HOME: temp("ork-cas-user-"),
        CODEX_HOME: temp("ork-cas-home-"),
        FAKE_SCENARIO: scenario,
        FAKE_CODEX_RECORD: record,
        ...env,
      },
    },
  );
  const start = (over: Partial<SessionSpec> = {}, allow = true): Session =>
    runtime.start(
      {
        nodeId: "cas",
        cwd,
        prompt: "Do the task",
        systemAppend: "# Ork",
        settingSources: ["project", "local"],
        tools: { allow: ["Bash"], deny: [] },
        permissionMode: "default",
        reportSchema: { type: "object" },
        ...over,
      },
      { human: humanOf(permits, allow) },
    );
  const lines = () =>
    readFileSync(record, "utf8")
      .split("\n")
      .filter(each => each !== "")
      .map(each => RecordSchema.parse(JSON.parse(each)));
  const frames = () =>
    lines().flatMap(each => (each.frame === undefined ? [] : [each.frame]));
  /** The first leg's arguments and the token it read. */
  const leg = () => {
    const found = lines().find(each => each.kind === "leg");
    return { token: found?.token ?? "", args: found?.args ?? [] };
  };
  return { start, lines, frames, permits, leg };
};

/**
 * Every event of a session: a message sent once it has started, and a stop once
 * the fake says it got the message.
 */
const steerThenStop = async (
  session: Session,
  message: string,
): Promise<RuntimeEvent[]> => {
  const seen: RuntimeEvent[] = [];
  for await (const event of session.events) {
    seen.push(event);
    if (event.type === "session.started") session.send(message);
    if (event.type === "assistant.text" && event.text.startsWith("got:")) {
      void session.interrupt();
    }
  }
  return seen;
};

const texts = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap(event =>
    event.type === "assistant.text" ? [event.text] : [],
  );

const methods = (frames: readonly { method?: string | undefined }[]) =>
  frames.flatMap(frame => (frame.method === undefined ? [] : [frame.method]));

describe("a codex-app-server session on the fake", () => {
  it("runs a prompt, an approval, a steer and a stop, then resumes by thread id", async () => {
    const run = fake("session");
    const first = await steerThenStop(run.start(), "Also update the docs");
    expect(texts(first)).toEqual([
      "Working on: Do the task",
      "command ran",
      "got: Also update the docs",
    ]);
    expect(run.permits).toEqual([
      { toolName: "Bash", input: { command: "pnpm test" } },
    ]);
    const stopped = outcomeOf(first);
    expect(stopped).toMatchObject({
      end: { kind: "interrupted" },
      sessionId: "th-fake-1",
    });
    const resumed = outcomeOf(
      await collect(
        run.start({ resume: stopped.sessionId, prompt: "carry on" }),
      ),
    );
    expect(resumed).toMatchObject({
      subtype: "success",
      sessionId: "th-fake-1",
      report: { status: "pass" },
    });
    expect(resumed.text).toBe("resumed th-fake-1: carry on");
    expect(methods(run.frames())).toEqual([
      "initialize",
      "initialized",
      "hooks/list",
      "thread/start",
      "turn/start",
      "turn/steer",
      "turn/interrupt",
      "initialize",
      "initialized",
      "hooks/list",
      "thread/resume",
      "turn/start",
    ]);
    expect(run.lines().filter(each => each.kind === "approval")).toMatchObject([
      { decision: "accept" },
    ]);
  });

  it("declines a command Ork's permit refuses, never for the session", async () => {
    const run = fake("session");
    const events = await steerThenStop(run.start({}, false), "stop now");
    expect(texts(events)).toContain("command declined");
    expect(run.lines().filter(each => each.kind === "approval")).toMatchObject([
      { decision: "decline" },
    ]);
  });

  it("keeps Ork's token in the process environment, out of every frame and argument", async () => {
    const run = fake("");
    expect(outcomeOf(await collect(run.start())).report).toMatchObject({
      status: "pass",
    });
    const { token, args } = run.leg();
    expect(token).toMatch(/^\S{16,}$/u);
    expect(args.join(" ")).not.toContain(token);
    expect(JSON.stringify(run.frames())).not.toContain(token);
  });

  it("ends with a driver error when Codex ran tools its hook never saw", async () => {
    const run = fake("", { FAKE_CODEX_NO_HOOK: "1" });
    expect(outcomeOf(await collect(run.start()))).toMatchObject({
      subtype: "error_driver",
      end: { kind: "driver_crashed" },
      errors: [HOOK_DID_NOT_RUN],
    });
  });

  it("refuses a leg whose Codex loads a user hook, before any thread", async () => {
    const run = fake("", { FAKE_CODEX_USER_HOOK: "1" });
    const outcome = outcomeOf(await collect(run.start()));
    expect(outcome.subtype).toBe("error_driver");
    expect(outcome.errors.join("\n")).toContain(
      "codex loads hooks Ork did not pass",
    );
    expect(methods(run.frames())).toEqual([
      "initialize",
      "initialized",
      "hooks/list",
    ]);
  });
});
