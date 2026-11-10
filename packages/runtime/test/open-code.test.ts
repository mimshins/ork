/**
 * @file The `open-code` adapter beyond the contract suite: deny by default, the
 *   worktree as the working folder, the config file holding the token (0600,
 *   outside the checkout, gone after the session and after a crash), the
 *   project's own config left alone, the token kept out of events, and the
 *   rules and arguments it writes.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  HumanChannel,
  RuntimeEvent,
  SessionSpec,
  ToolRules,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type CliAdapter,
  createOpenCodeAdapter,
  createSessionRuntime,
  openCodeArgs,
  permissionRules,
} from "../src/index.ts";
import {
  collect,
  collectActing,
  outcomeOf,
  resultsOf,
} from "./contract/harness.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-opencode.mjs", import.meta.url),
);

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const specOf = (cwd: string, tools: ToolRules): SessionSpec => ({
  nodeId: "oc",
  cwd,
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools,
  permissionMode: "default",
  reportSchema: { type: "object" },
});

/** What the fake recorded it was started with. */
const RecordSchema = z.object({
  cwd: z.string(),
  args: z.array(z.string()),
  configFile: z.string(),
  config: z.object({
    mcp: z.object({
      servers: z.object({
        ork: z.object({ headers: z.object({ Authorization: z.string() }) }),
      }),
    }),
  }),
  env: z.object({
    XDG_CONFIG_HOME: z.string(),
    OPENCODE_DISABLE_PROJECT_CONFIG: z.string(),
  }),
});

const NOTHING_ALLOWED: ToolRules = { allow: [], deny: [] };

const ConfigSchema = z.looseObject({ permissions: z.array(z.unknown()) });

/** The adapter with its config's first rule, the deny-all, taken out. */
const withoutDenyAll = (adapter: CliAdapter): CliAdapter => ({
  ...adapter,
  mcp: {
    ...adapter.mcp,
    wire: async (spec, endpoint, hooks) => {
      const wired = await adapter.mcp.wire(spec, endpoint, hooks);
      const file = wired.env["OPENCODE_CONFIG"] ?? "";
      const config = ConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      const permissions = config.permissions.slice(1);
      writeFileSync(file, JSON.stringify({ ...config, permissions }));
      return wired;
    },
  },
});

/** Starts a session on the fake, recording what it was started with. */
const run = (
  scenario: string,
  tools = NOTHING_ALLOWED,
  wrap = (adapter: CliAdapter): CliAdapter => adapter,
) => {
  const cwd = temp("ork-oc-");
  const secrets = temp("ork-oc-secrets-");
  const record = path.join(secrets, "record.json");
  const session = createSessionRuntime(
    wrap(createOpenCodeAdapter({ secretRoot: path.join(secrets, "root") })),
    {
      bin: FAKE,
      env: {
        ...process.env,
        FAKE_SCENARIO: scenario,
        FAKE_OPENCODE_RECORD: record,
      },
    },
  ).start(specOf(cwd, tools), { human });
  return {
    cwd,
    root: path.join(secrets, "root"),
    session,
    recorded: () =>
      RecordSchema.parse(JSON.parse(readFileSync(record, "utf8"))),
  };
};

/** A pid no process has any more. */
const deadPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid ?? 0;

const textOf = (events: readonly RuntimeEvent[]): string =>
  outcomeOf(events).text;

describe("the open-code adapter", () => {
  it("refuses a shell call the node did not allow", async () => {
    const events = await collect(run("try-denied").session);
    expect(resultsOf(events, "Bash")).toEqual([true]);
    expect(textOf(events)).toBe("shell was refused");
  });

  it("refuses that call only through its deny-all rule, as OpenCode runs a call no rule matches", async () => {
    const events = await collect(
      run("try-denied", NOTHING_ALLOWED, withoutDenyAll).session,
    );
    expect(resultsOf(events, "Bash")).toEqual([false]);
    expect(textOf(events)).toBe("shell ran");
  });

  it("runs a shell call the node allowed", async () => {
    const events = await collect(
      run("try-denied", { allow: ["Bash(ls)"], deny: [] }).session,
    );
    expect(resultsOf(events, "Bash")).toEqual([false]);
  });

  it("runs in the node's worktree", async () => {
    const started = run("");
    await collect(started.session);
    expect(started.recorded().cwd).toBe(started.cwd);
  });

  it("writes the config at 0600 outside the checkout, and removes it after", async () => {
    const started = run("");
    let file = "";
    let mode = 0;
    await collectActing(started.session, () => {
      file = started.recorded().configFile;
      mode = statSync(file).mode & 0o777;
    });
    expect(mode).toBe(0o600);
    expect(file.startsWith(started.cwd)).toBe(false);
    expect(file.startsWith(started.root)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(started.recorded().args.join(" ")).not.toContain("Bearer");
  });

  it("keeps the bearer token out of the events and the outcome", async () => {
    const started = run("");
    const events = await collect(started.session);
    const header =
      started.recorded().config.mcp.servers.ork.headers.Authorization;
    const token = header.replace("Bearer ", "");
    expect(token.length).toBeGreaterThan(16);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("removes a config a crashed process left behind", async () => {
    const started = run("");
    const stale = path.join(started.root, `${String(deadPid())}-x`);
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, "opencode.json"), "{}");
    await collect(started.session);
    expect(existsSync(stale)).toBe(false);
  });

  it("keeps the machine's and the project's OpenCode config out, and leaves .mcp.json alone", async () => {
    const started = run("");
    const mcp = '{"mcpServers":{"mine":{"command":"x"}}}\n';
    writeFileSync(path.join(started.cwd, ".mcp.json"), mcp);
    await collect(started.session);
    const { env, configFile } = started.recorded();
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(path.dirname(env.XDG_CONFIG_HOME)).toBe(path.dirname(configFile));
    expect(readFileSync(path.join(started.cwd, ".mcp.json"), "utf8")).toBe(mcp);
  });

  it("ends with the errors OpenCode printed when it fails", async () => {
    const outcome = outcomeOf(await collect(run("fail").session));
    expect(outcome).toMatchObject({
      subtype: "error_during_execution",
      errors: ["model not found"],
    });
  });

  it("continues and forks a session by id, the message last", () => {
    const spec = {
      ...specOf("/w", { allow: [], deny: [] }),
      model: "anthropic/x",
      resume: "ses_1",
      fork: true,
    };
    expect(openCodeArgs(spec)).toEqual([
      "run",
      "--standalone",
      "--format",
      "json",
      "--agent",
      "ork",
      "--model",
      "anthropic/x",
      "--session",
      "ses_1",
      "--fork",
      "Do the task",
    ]);
  });

  it("keeps a message that starts with `-` from reading as a flag", () => {
    const spec = {
      ...specOf("/w", { allow: [], deny: [] }),
      prompt: "--help me",
    };
    expect(openCodeArgs(spec).at(-1)).toBe(" --help me");
  });
});

const rules = (
  tools: ToolRules,
  mode: SessionSpec["permissionMode"] = "default",
) => permissionRules({ ...specOf("/w", tools), permissionMode: mode });

describe("the open-code permission rules", () => {
  it("deny everything first, then open the worktree's reads and Ork's tools", () => {
    expect(rules({ allow: [], deny: [] })).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "read", resource: "/w/*", effect: "allow" },
      { action: "ork_*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "deny" },
    ]);
  });

  it("write the node's allows in OpenCode's words, and its denies last", () => {
    const written = rules({
      allow: ["Bash(git status:*)", "Edit", "mcp__github__get_issue", "Nope"],
      deny: ["WebFetch"],
    });
    expect(written.slice(2, 5)).toEqual([
      { action: "shell", resource: "git status *", effect: "allow" },
      { action: "edit", resource: "/w/*", effect: "allow" },
      { action: "github_get_issue", resource: "*", effect: "allow" },
    ]);
    expect(written.at(-1)).toEqual({
      action: "webfetch",
      resource: "*",
      effect: "deny",
    });
  });

  it("keep `.env` refused after a node's read allow", () => {
    const written = rules({ allow: ["Read"], deny: [] });
    expect(written.findLast(r => r.action === "read")).toEqual({
      action: "read",
      resource: "*.env",
      effect: "deny",
    });
  });

  it("drop built-in allows outside `only`, and refuse edits and shell in plan mode", () => {
    const written = rules(
      { allow: ["Bash", "Grep"], deny: [], only: ["Grep"] },
      "plan",
    );
    expect(written.map(r => `${r.action}:${r.effect}`)).toEqual([
      "*:deny",
      "grep:allow",
      "ork_*:allow",
      "read:deny",
      "edit:deny",
      "shell:deny",
    ]);
  });
});
