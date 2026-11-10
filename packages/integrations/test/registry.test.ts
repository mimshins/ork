/**
 * @file Tests for the integration and driver registries: ids are unique and
 *   consistent, and adapters build their own arguments.
 */

import { describe, expect, it } from "vitest";

import {
  type Exec,
  aws,
  AGENT_DRIVERS,
  DRIVER_IDS,
  git,
  INTEGRATIONS,
  integrationFor,
  MIN_CLAUDE_VERSION,
  olderThan,
} from "../src/index.ts";

describe("the registries", () => {
  it("have unique ids, and the driver ids match the descriptors", () => {
    const ids = INTEGRATIONS.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AGENT_DRIVERS.map(d => d.id)).toEqual([...DRIVER_IDS]);
  });

  it("find the integration behind a node type", () => {
    expect(integrationFor("tool.aws")).toBe(aws);
    expect(integrationFor("tool.git")).toBe(git);
    expect(integrationFor("tool.nope")).toBeUndefined();
    expect(integrationFor("claude.worker")).toBeUndefined();
  });

  it("let an adapter add its own arguments", () => {
    expect(aws.args({ profile: "dev", region: "eu-west-1" })).toEqual([
      "--profile",
      "dev",
      "--region",
      "eu-west-1",
    ]);
    expect(aws.args({})).toEqual([]);
  });

  it("let an adapter set a default allow list: git adds and commits, never pushes", () => {
    expect(git.allow).toEqual(["add", "commit"]);
    expect(aws.allow).toBeUndefined();
  });
});

describe("the claude version check", () => {
  it("compares `claude --version` output with the minimum", () => {
    expect(olderThan("2.1.280 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(true);
    expect(olderThan("2.1.281 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(false);
    expect(olderThan("2.2.0 (Claude Code)", MIN_CLAUDE_VERSION)).toBe(false);
    expect(olderThan("unknown", MIN_CLAUDE_VERSION)).toBe(false);
  });
});

/** `claude-code`'s check with a `claude` that answers `outputs`, under `env`. */
const claudeCheck = (
  outputs: Record<string, string>,
  env: Record<string, string> = {},
) => {
  const exec: Exec = (program, args) => {
    const stdout = outputs[[program, ...args].join(" ")];
    return Promise.resolve(
      stdout === undefined ? { ok: false, stdout: "" } : { ok: true, stdout },
    );
  };
  return AGENT_DRIVERS[0].doctor(exec, env);
};

/** An `exec` where every program succeeds and prints nothing. */
const answersAnything: Exec = () => Promise.resolve({ ok: true, stdout: "" });

const VERSION = { "claude --version": "2.1.314 (Claude Code)\n" };
const LOGGED_OUT = {
  ...VERSION,
  "claude auth status --json": JSON.stringify({ loggedIn: false }),
};

describe("the claude-code driver's check", () => {
  it("is ready with a claude login, and says how", async () => {
    expect(
      await claudeCheck({
        ...VERSION,
        "claude auth status --json": JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
        }),
      }),
    ).toMatchObject({
      status: "ok",
      detail: "2.1.314 (Claude Code), logged in (claude.ai)",
    });
  });

  it.each([
    ["ANTHROPIC_API_KEY", "k", "ANTHROPIC_API_KEY is set"],
    [
      "CLAUDE_CODE_USE_BEDROCK",
      "1",
      "Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK)",
    ],
    [
      "CLAUDE_CODE_USE_VERTEX",
      "1",
      "Google Vertex AI (CLAUDE_CODE_USE_VERTEX)",
    ],
    [
      "CLAUDE_CODE_USE_FOUNDRY",
      "1",
      "Microsoft Foundry (CLAUDE_CODE_USE_FOUNDRY)",
    ],
  ])("is ready without a login when %s is set", async (name, value, says) => {
    expect(await claudeCheck(LOGGED_OUT, { [name]: value })).toMatchObject({
      status: "ok",
      detail: `2.1.314 (Claude Code), ${says}`,
    });
  });

  it("is not ready with no login, key or cloud provider", async () => {
    expect(await claudeCheck(LOGGED_OUT)).toMatchObject({
      status: "warn",
      detail: "2.1.314 (Claude Code), not logged in",
    });
  });

  it("is not ready without a claude, whatever the environment", async () => {
    expect(await claudeCheck({}, { ANTHROPIC_API_KEY: "k" })).toMatchObject({
      status: "warn",
      detail: "claude CLI not found",
    });
  });

  it("lists the other drivers as ready once their tool answers", async () => {
    const others = await Promise.all(
      AGENT_DRIVERS.slice(1).map(d => d.doctor(answersAnything, {})),
    );
    expect(others.map(r => r.status)).toEqual(["ok", "ok"]);
    expect(others.some(r => r.detail.includes("unproven"))).toBe(false);
  });

  it("skips a driver whose tool is missing, saying how to get it", async () => {
    const found = await AGENT_DRIVERS[2].doctor(
      () => Promise.resolve({ ok: false, stdout: "" }),
      {},
    );
    expect(found).toMatchObject({
      status: "skip",
      detail: "cmd CLI not found",
      hint: "Install cmd to use the command-code driver.",
    });
  });

  it("declares what each driver does itself, each proven", () => {
    const [claude, open, command] = AGENT_DRIVERS;
    expect(claude.proven).toBe(true);
    expect(Object.values(claude.capabilities).every(Boolean)).toBe(true);
    expect([open.proven, command.proven]).toEqual([true, true]);
    expect(open.capabilities).toEqual({
      questions: true,
      permissionPrompt: false,
      price: true,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: true,
      mcpServers: true,
    });
    expect(command.capabilities).toEqual({
      questions: true,
      permissionPrompt: false,
      price: false,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: true,
      mcpServers: false,
    });
  });
});
