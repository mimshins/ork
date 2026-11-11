/**
 * @file Tests for the `command-code` adapter (RFC-014) on the fake `cmd`: its
 *   arguments, its decoder (session id, turns, `max_turns`), the session mod
 *   that refuses what a node did not allow (deny by default), a second session
 *   in the same checkout waiting for the first, and the `ork` MCP entry gone
 *   after a session with the user's other entries left as they were.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  HumanChannel,
  RuntimeEvent,
  Session,
  SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  commandCodeAdapter,
  commandCodeArgs,
  commandCodeDecoder,
  createSessionRuntime,
  writeMod,
} from "../src/index.ts";
import { collectActing } from "./contract/harness.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-command.mjs", import.meta.url),
);
const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "none" }),
};
const tmp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-cmd-${name}-`));

const specOf = (cwd: string, tools: SessionSpec["tools"]): SessionSpec => ({
  nodeId: "build",
  cwd,
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools,
  permissionMode: "default",
  reportSchema: { type: "object" },
});

type Place = { home: string; runs: string };

const place = (): Place => {
  const home = tmp("home");
  return { home, runs: path.join(home, "runs") };
};

const startIn = (at: Place, spec: SessionSpec, scenario: string): Session =>
  createSessionRuntime(commandCodeAdapter, {
    bin: FAKE,
    env: { ...process.env, HOME: at.home, FAKE_SCENARIO: scenario },
    runs: at.runs,
  }).start(spec, { human });

const drain = async (events: AsyncIterator<RuntimeEvent>): Promise<void> => {
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- events come in order
    if ((await events.next()).done === true) return;
  }
};

const collect = async (session: Session): Promise<RuntimeEvent[]> => {
  const seen: RuntimeEvent[] = [];
  for await (const event of session.events) seen.push(event);
  return seen;
};

/** Whether each `Bash` call's result was an error, in order. */
const shellResults = (events: readonly RuntimeEvent[]): boolean[] => {
  const ids = new Set(
    events.flatMap(e =>
      e.type === "tool.called" && e.name === "Bash" ? [e.id] : [],
    ),
  );
  return events.flatMap(e =>
    e.type === "tool.result" && ids.has(e.id) ? [e.isError] : [],
  );
};

const LocalSchema = z.object({ mcpServers: z.record(z.string(), z.unknown()) });

const localConfig = (at: Place, folder: string) => {
  const slug = realpathSync(folder)
    .replaceAll(/[^a-zA-Z0-9]/gu, "-")
    .replace(/^-+/u, "");
  const file = path.join(at.home, ".commandcode", "projects", slug, "mcp.json");
  return LocalSchema.parse(JSON.parse(readFileSync(file, "utf8")));
};

const localEntries = (at: Place, folder: string): string[] =>
  Object.keys(localConfig(at, folder).mcpServers);

const OrkEntrySchema = z.object({
  headers: z.object({ Authorization: z.string() }),
});

type Decide = (name: string, input: Record<string, unknown>) => unknown;

/** The `decide` of a session mod written for `tools`. */
const decideOf = async (tools: SessionSpec["tools"]): Promise<Decide> => {
  const mod = writeMod(specOf(tmp("mod"), tools));
  const loaded = z
    .object({
      decide: z.custom<Decide>(value => typeof value === "function"),
    })
    .parse(await import(pathToFileURL(mod.file).href));
  mod.remove();
  return loaded.decide;
};

describe("the command-code adapter's arguments", () => {
  it("runs -p in json mode, prompting for nothing, with Ork's instructions first", () => {
    const spec = { ...specOf("/x", { allow: [], deny: [] }), maxTurns: 3 };
    expect(commandCodeArgs(spec)).toEqual([
      "-p",
      "# Ork\n\nDo the task",
      "--output-format",
      "json",
      "--permission-mode",
      "yolo",
      "--dangerously-skip-permissions",
      "--skip-onboarding",
      "--no-auto-update",
      "--max-turns",
      "3",
    ]);
  });

  it("resumes, or forks, a session with the message alone", () => {
    const spec = {
      ...specOf("/x", { allow: [], deny: [] }),
      prompt: "-more",
      resume: "s1",
      fork: true,
    };
    expect(commandCodeArgs(spec).slice(0, 2)).toEqual(["-p", " -more"]);
    expect(commandCodeArgs(spec).slice(-3)).toEqual([
      "--resume",
      "s1",
      "--fork-session",
    ]);
  });
});

describe("the command-code decoder", () => {
  it("takes the session id from run_start, counts turns, and maps max_turns", () => {
    const { decode, exit } = commandCodeDecoder();
    const lines = [
      { type: "event", event: { type: "run_start", sessionId: "s9" } },
      { type: "event", event: { type: "turn_start", turnNumber: 1 } },
      { type: "event", event: { type: "turn_start", turnNumber: 2 } },
      { type: "result", subtype: "max_turns", usage: {}, finalText: "" },
    ];
    const events = [
      ...lines.flatMap(line => decode(JSON.stringify(line)).events),
      ...exit(8),
    ];
    expect(events[0]).toEqual({
      type: "session.started",
      sessionId: "s9",
      model: "",
    });
    expect(events.at(-1)).toMatchObject({
      outcome: {
        subtype: "error_max_turns",
        end: { kind: "turn_limit" },
        sessionId: "s9",
        usage: { turns: 2, costUsd: 0 },
      },
    });
  });
});

describe("the command-code session mod", () => {
  it("refuses everything to a node that allowed nothing, but Ork's own tools", async () => {
    const decide = await decideOf({ allow: [], deny: [] });
    expect(decide("shell", { command: "ls" })).toBeDefined();
    expect(decide("edit_file", {})).toBeDefined();
    expect(decide("mcp__github__issue", {})).toBeDefined();
    expect(decide("mcp__ork__report", {})).toBeUndefined();
    expect(decide("search_tools", { query: "report" })).toBeUndefined();
  });

  it("allows what the node allowed, in Claude Code's words; a deny wins", async () => {
    const decide = await decideOf({
      allow: ["Bash(git:*)", "Read", "mcp__github"],
      deny: ["Bash(git push:*)", "WebFetch(domain:x)"],
    });
    expect(decide("shell", { command: "git status" })).toBeUndefined();
    expect(decide("shell", { command: "git push" })).toBeDefined();
    expect(decide("shell", { command: "rm -rf /" })).toBeDefined();
    expect(decide("grep", {})).toBeUndefined();
    expect(decide("mcp__github__issue", {})).toBeUndefined();
    expect(decide("web_fetch", {})).toBeDefined();
  });

  it("refuses a verify: node's full check, but not its targeted tests", async () => {
    const decide = await decideOf({
      allow: ["Bash(pnpm check)", "Bash(pnpm test)", "Bash(vitest run *)"],
      deny: ["Bash(pnpm check)", "Bash(pnpm test)", "Bash(vitest run)"],
    });
    expect(decide("shell", { command: "pnpm check" })).toBeDefined();
    expect(decide("shell", { command: "pnpm test" })).toBeDefined();
    expect(decide("shell", { command: "vitest run" })).toBeDefined();
    const targeted = { command: "vitest run packages/cli/test/x.test.ts" };
    expect(decide("shell", targeted)).toBeUndefined();
  });
});

describe("the command-code session mod's reads", () => {
  it("lets a read inside the worktree through without a rule", async () => {
    const decide = await decideOf({ allow: [], deny: [] });
    expect(decide("read_file", { file_path: "src/a.ts" })).toBeUndefined();
    expect(decide("grep", { pattern: "x" })).toBeUndefined();
    expect(
      decide("read_multiple_files", { paths: ["a", "b/c"] }),
    ).toBeUndefined();
  });

  it("refuses one that reaches outside it, and keeps a node's deny", async () => {
    const decide = await decideOf({ allow: [], deny: ["Read(secrets/*)"] });
    expect(decide("read_file", { file_path: "/etc/hosts" })).toBeDefined();
    expect(decide("read_file", { file_path: "../other/a.ts" })).toBeDefined();
    expect(decide("read_file", { file_path: "secrets/key" })).toBeDefined();
  });
});

describe("a command-code session", () => {
  it("refuses a shell call to a node that allowed none", async () => {
    const at = place();
    const spec = specOf(tmp("checkout"), { allow: [], deny: [] });
    const events = await collect(startIn(at, spec, "try-denied"));
    expect(shellResults(events)).toEqual([true]);
  });

  it("runs a shell call the node allowed", async () => {
    const at = place();
    const spec = specOf(tmp("checkout"), { allow: ["Bash(ls)"], deny: [] });
    const events = await collect(startIn(at, spec, "try-denied"));
    expect(shellResults(events)).toEqual([false]);
  });

  it("removes its ork MCP entry after, leaving the user's other entries", async () => {
    const at = place();
    const folder = tmp("checkout");
    execFileSync(
      FAKE,
      ["mcp", "add", "--scope", "local", "mine", "http://x/1"],
      { cwd: folder, env: { ...process.env, HOME: at.home } },
    );
    await collect(startIn(at, specOf(folder, { allow: [], deny: [] }), ""));
    expect(localEntries(at, folder)).toEqual(["mine"]);
  });

  it("ends with error_max_turns when cmd exits 8 at its turn limit", async () => {
    const spec = specOf(tmp("checkout"), { allow: [], deny: [] });
    const events = await collect(startIn(place(), spec, "max-turns"));
    expect(events.at(-1)).toMatchObject({
      type: "session.finished",
      outcome: { subtype: "error_max_turns" },
    });
  });

  it("keeps the bearer token of its ork entry out of the events", async () => {
    const at = place();
    const folder = tmp("checkout");
    let header = "";
    const events = await collectActing(
      startIn(at, specOf(folder, { allow: [], deny: [] }), ""),
      () => {
        header = OrkEntrySchema.parse(localConfig(at, folder).mcpServers["ork"])
          .headers.Authorization;
      },
    );
    const token = header.replace("Bearer ", "");
    expect(token.length).toBeGreaterThan(16);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("waits for another session in the same checkout to end", async () => {
    const at = place();
    const spec = specOf(tmp("checkout"), { allow: [], deny: [] });
    const first = startIn(at, spec, "hang");
    const firstEvents = first.events[Symbol.asyncIterator]();
    await firstEvents.next();
    const second = collect(startIn(at, spec, ""));
    // The first holds the checkout until it is interrupted, and ends.
    setTimeout(() => void first.interrupt(), 1500);
    const [events] = await Promise.all([second, drain(firstEvents)]);
    expect(events[0]).toMatchObject({ type: "session.waiting" });
    expect(events.at(-1)).toMatchObject({
      type: "session.finished",
      outcome: { subtype: "success" },
    });
  });
});
