/**
 * @file The `omp` adapter's legs and wiring (RFC-026): each leg's arguments
 *   (the flags always and never passed, the thinking level, resume and fork,
 *   the `--tools` list), the wiring's files and flags (the private folder and
 *   its modes, the session folder, the hold file only with a hold endpoint, the
 *   token in no argument and no variable, `--max-cost` from Ork's ledger, the
 *   stopped marker on a stop, the removal on release), the hold's answers, the
 *   leg decoder bound to the ledger, and one whole session on the fake `omp`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import type {
  CliAdapter,
  LegDecoder,
  OrkEndpoint,
  WireHooks,
} from "../src/adapter.ts";
import {
  addSpend,
  HELD,
  OMP_HOLD_WINDOW_MS,
  OMP_STOPPED_FILE,
  ompArgs,
  ompFolders,
  ompHoldAnswer,
  sessionSpend,
} from "../src/index.ts";
import { collect, outcomeOf } from "./contract/harness.ts";
import {
  adapterIn,
  flagOf,
  ompSpec as spec,
  played,
  temp,
  valueOf,
} from "./fixtures/omp-session.ts";

const TOKEN = "tok-secret-omp";
const ENDPOINT: OrkEndpoint = { url: "http://127.0.0.1:1/mcp", token: TOKEN };
const HOLDING: OrkEndpoint = {
  ...ENDPOINT,
  holdUrl: "http://127.0.0.1:1/hold",
};

const NEVER = new Set([
  "-e",
  "--extension",
  "--hook",
  "--yolo",
  "--plan-yolo",
  "--advisor",
  "--api-key",
  "--profile",
  "--no-session",
  "--no-context-files",
  "--no-tools",
  "rpc",
  "--approval-mode",
]);

describe("the arguments of an omp leg", () => {
  it("starts in print mode with omp's extras off, and ends with the brief", () => {
    expect(ompArgs({ ...spec, model: "openai/gpt-5.2" })).toEqual([
      "-p",
      "--mode",
      "json",
      "--no-skills",
      "--no-rules",
      "--no-title",
      "--no-lsp",
      "--no-pty",
      "--no-prewalk",
      "--no-judge",
      "--no-spotlight",
      "--offline",
      "--model",
      "openai/gpt-5.2",
      "--tools",
      "read,grep,glob",
      "--thinking",
      "medium",
      "--append-system-prompt",
      "# Ork",
      "Do the task",
    ]);
  });

  it("passes no model when the node names none", () => {
    expect(ompArgs(spec)).not.toContain("--model");
  });

  it("puts a space before a brief that starts with a dash", () => {
    expect(ompArgs({ ...spec, prompt: "-rf" }).at(-1)).toBe(" -rf");
  });

  it.each(["low", "medium", "high", "xhigh", "max"] as const)(
    "thinks at the node's effort %s",
    effort => {
      expect(valueOf(ompArgs({ ...spec, effort }), "--thinking")).toBe(effort);
    },
  );

  it("resumes or forks, never both, and passes the instructions on every leg", () => {
    const resumed = ompArgs({ ...spec, resume: "s-1" });
    const forked = ompArgs({ ...spec, resume: "s-1", fork: true });
    expect([valueOf(resumed, "--resume"), resumed.includes("--fork")]).toEqual([
      "s-1",
      false,
    ]);
    expect([valueOf(forked, "--fork"), forked.includes("--resume")]).toEqual([
      "s-1",
      false,
    ]);
    for (const args of [ompArgs(spec), resumed, forked]) {
      expect(valueOf(args, "--append-system-prompt")).toBe("# Ork");
      expect(valueOf(args, "--thinking")).toBe("medium");
    }
  });

  it.each<[string, Partial<SessionSpec>, string]>([
    ["a default node", {}, "read,grep,glob"],
    [
      "a readonly node",
      { tools: { allow: ["Bash(git status)"], deny: ["Edit", "Write"] } },
      "read,bash,grep,glob",
    ],
    [
      "plan mode",
      { permissionMode: "plan", tools: { allow: ["Bash", "Edit"], deny: [] } },
      "read,grep,glob",
    ],
    [
      "acceptEdits with no allow",
      { permissionMode: "acceptEdits" },
      "read,edit,write,grep,glob",
    ],
    [
      "an allowed shell prefix and edits",
      { tools: { allow: ["Bash(git status)", "Edit"], deny: [] } },
      "read,edit,write,bash,grep,glob",
    ],
    ["--yolo", { yolo: true }, "read,edit,write,bash,grep,glob"],
    [
      "only reads",
      { yolo: true, tools: { allow: [], deny: [], only: ["Read"] } },
      "read,grep,glob",
    ],
    [
      "Grep and Glob withheld",
      { tools: { allow: [], deny: ["Grep", "Glob"] } },
      "read",
    ],
    [
      "a path-scoped Read deny",
      { tools: { allow: ["Bash"], deny: ["Read(./secrets/**)"] } },
      "bash",
    ],
  ])("offers what %s may use", (_case, over, tools) => {
    const args = ompArgs({ ...spec, ...over });
    expect(valueOf(args, "--tools")).toBe(tools);
  });

  it("never passes a flag that widens or bypasses the fence", () => {
    const legs = [
      ompArgs({ ...spec, yolo: true }),
      ompArgs({ ...spec, resume: "s-1" }),
      ompArgs({ ...spec, resume: "s-1", fork: true }),
    ];
    for (const args of legs) {
      expect(args.filter(arg => NEVER.has(arg))).toEqual([]);
      expect(valueOf(args, "--tools")).not.toMatch(/eval|task/u);
      expect(valueOf(args, "--thinking")).not.toBe("auto");
    }
  });
});

describe("the hold's answers", () => {
  it("lets a call go with nothing, and refuses a deferred one with HELD", () => {
    expect(ompHoldAnswer("go")).toEqual({});
    expect(ompHoldAnswer("defer")).toEqual(HELD);
    expect(OMP_HOLD_WINDOW_MS).toBe(3_600_000);
  });
});

const hooksOf = (controller = new AbortController()): WireHooks => ({
  waiting: () => {},
  signal: controller.signal,
});

const mode = (file: string): number => statSync(file).mode & 0o777;

/** Every file under `dir`, relative to it. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();

describe("the omp wiring", () => {
  it("names the session folder and the private files by absolute path, outside the checkout", async () => {
    const { adapter, home, root } = adapterIn();
    const cwd = temp("ork-omp-cwd-");
    const wired = await adapter.mcp.wire({ ...spec, cwd }, ENDPOINT, hooksOf());
    const sessions = flagOf(wired.args, "--session-dir");
    expect(sessions).toBe(path.join(home, ".ork", "omp", "sessions"));
    expect(mode(sessions)).toBe(0o700);
    const own = ["--config", "--trusted-extension", "--plugin-dir"].map(flag =>
      flagOf(wired.args, flag),
    );
    for (const file of own) {
      expect(path.isAbsolute(file)).toBe(true);
      expect(file.startsWith(root)).toBe(true);
      expect(file.startsWith(cwd)).toBe(false);
    }
    const dir = path.dirname(flagOf(wired.args, "--config"));
    expect(mode(dir)).toBe(0o700);
    expect(
      filesUnder(dir).map(file => [file, mode(path.join(dir, file))]),
    ).toEqual([
      ["guard.mjs", 0o600],
      ["overlay.yml", 0o600],
      ["plugin/.claude-plugin/plugin.json", 0o600],
      ["plugin/.mcp.json", 0o600],
    ]);
    expect(readdirSync(cwd)).toEqual([]);
    await wired.release();
  });

  it("writes the hold file only with a hold endpoint, and the guard names its folder", async () => {
    const { adapter } = adapterIn();
    const held = await adapter.mcp.wire(spec, HOLDING, hooksOf());
    const guard = flagOf(held.args, "--trusted-extension");
    const dir = path.dirname(guard);
    expect(
      JSON.parse(readFileSync(path.join(dir, "hold.json"), "utf8")),
    ).toEqual({ url: HOLDING.holdUrl, token: TOKEN });
    expect(mode(path.join(dir, "hold.json"))).toBe(0o600);
    expect(readFileSync(guard, "utf8")).toContain(JSON.stringify(dir));
    expect(readFileSync(guard, "utf8")).not.toContain(TOKEN);
    const overlay = readFileSync(flagOf(held.args, "--config"), "utf8");
    expect(overlay).toContain(
      `toolCallTimeoutMs: ${String(2 * OMP_HOLD_WINDOW_MS + 60_000)}`,
    );
    const plain = await adapter.mcp.wire(spec, ENDPOINT, hooksOf());
    const plainDir = path.dirname(flagOf(plain.args, "--config"));
    expect(existsSync(path.join(plainDir, "hold.json"))).toBe(false);
    await held.release();
    await plain.release();
  });

  it("keeps the token out of the arguments and the environment, and asks omp to fail closed", async () => {
    const { adapter } = adapterIn();
    const wired = await adapter.mcp.wire(
      { ...spec, budgetUsd: 1 },
      HOLDING,
      hooksOf(),
    );
    const leg = [...ompArgs(spec), ...wired.args];
    expect(leg.some(arg => arg.includes(TOKEN))).toBe(false);
    expect(wired.env).toEqual({
      OMP_MCP_REQUIRE_READY: "1",
      OMP_MCP_TIMEOUT_MS: "0",
    });
    await wired.release();
  });

  it("caps dollars at the session's spend so far plus budgetUsd", async () => {
    const { adapter, home } = adapterIn();
    const { spent } = ompFolders(home);
    addSpend(spent, "s-old", 0.25);
    const capOf = async (over: Partial<SessionSpec>) => {
      const wired = await adapter.mcp.wire(
        { ...spec, ...over },
        ENDPOINT,
        hooksOf(),
      );
      await wired.release();
      return valueOf(wired.args, "--max-cost");
    };
    expect(await capOf({})).toBeUndefined();
    expect(await capOf({ budgetUsd: 1 })).toBe("1");
    expect(await capOf({ budgetUsd: 1, resume: "s-old" })).toBe("1.25");
    expect(await capOf({ budgetUsd: 1, resume: "s-old", fork: true })).toBe(
      "1.25",
    );
    expect(await capOf({ budgetUsd: 1, resume: "s-unknown" })).toBe("1");
  });

  it("writes the stopped marker at once on a stop, and removes the folder on release", async () => {
    const { adapter, root } = adapterIn();
    const controller = new AbortController();
    const wired = await adapter.mcp.wire(spec, HOLDING, hooksOf(controller));
    const dir = path.dirname(flagOf(wired.args, "--config"));
    expect(existsSync(path.join(dir, OMP_STOPPED_FILE))).toBe(false);
    controller.abort();
    expect(existsSync(path.join(dir, OMP_STOPPED_FILE))).toBe(true);
    await wired.release();
    expect(readdirSync(root)).toEqual([]);
  });

  it("does not throw when a stop comes after the release", async () => {
    const { adapter } = adapterIn();
    const controller = new AbortController();
    const wired = await adapter.mcp.wire(spec, ENDPOINT, hooksOf(controller));
    await wired.release();
    expect(() => {
      controller.abort();
    }).not.toThrow();
  });
});

const sessionLine = (id: string) =>
  JSON.stringify({ type: "session", version: 3, id, cwd: "/w" });

const paid = (usd: number) =>
  JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
        cost: { total: usd },
      },
      stopReason: "stop",
    },
  });

/** A leg's decoder of `adapter`, which must have one. */
const decoderOf = (adapter: CliAdapter, leg: SessionSpec): LegDecoder => {
  if (adapter.legDecoder === undefined) throw new Error("no leg decoder");
  return adapter.legDecoder(leg);
};

/** The cost of the end a decoder gives at exit 0. */
const costAtExit = (decoder: LegDecoder): number | undefined => {
  const end = decoder.exit(0).find(event => event.type === "session.finished");
  return end?.type === "session.finished"
    ? end.outcome.usage.costUsd
    : undefined;
};

describe("the omp leg decoder", () => {
  it("adds each request's dollars to the ledger, and starts a resumed leg from it", () => {
    const { adapter, home } = adapterIn();
    const { spent } = ompFolders(home);
    const first = decoderOf(adapter, spec);
    first.decode(sessionLine("s-1"));
    first.decode(paid(0.5));
    expect(sessionSpend(spent, "s-1")).toBe(0.5);
    // The ledger is read again when each leg starts.
    const second = decoderOf(adapter, { ...spec, resume: "s-1" });
    second.decode(sessionLine("s-1"));
    second.decode(paid(0.25));
    expect(sessionSpend(spent, "s-1")).toBe(0.75);
    expect(costAtExit(second)).toBe(0.75);
  });
});

describe("an omp session on the fake omp", () => {
  it("asks, reports and ends, leaving the checkout and the private folders clean", async () => {
    const { session, cwd, root, legs } = played();
    const events = await collect(session);
    expect(outcomeOf(events).report?.status).toBe("pass");
    expect(readdirSync(cwd)).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
    expect(legs().length).toBeGreaterThan(0);
    for (const { args } of legs()) {
      for (const flag of ["--trusted-extension", "--plugin-dir", "--config"]) {
        expect(valueOf(args, flag)).toBeDefined();
      }
      expect(args.some(arg => arg.includes(TOKEN))).toBe(false);
    }
  });

  it("removes the private folder after a session that failed", async () => {
    const { session, root } = played({ scenario: "end:auth" });
    const events = await collect(session);
    expect(outcomeOf(events).subtype).not.toBe("success");
    expect(readdirSync(root)).toEqual([]);
  });
});
