/**
 * @file The `codex-app-server` adapter beyond the contract suite, without a
 *   process: each leg's arguments (`app-server`, the switches and keys it
 *   takes, none of `exec`'s flags, never a wider sandbox), its strategies (a
 *   callback for approvals, no hold), the wiring (Ork's MCP keys and hook by
 *   `-c`, the token in the environment only, a hooks file refusing the
 *   session), the thread request (the hook's trust, the sandbox, no token), the
 *   hook fence on `hooks/list`, and the canary on a codec whose leg ran a tool
 *   the hook never saw.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeEvent, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import type { Codec, DecodedFrame, Frame } from "../src/adapter.ts";
import { hookFence } from "../src/adapters/codex-app-server-events.ts";
import {
  CODEX_APP_SERVER_CONFIG,
  CODEX_TOKEN_VAR,
  codexAppServerAdapter,
  codexAppServerArgs,
  createCodexAppServerAdapter,
  HOOK_DID_NOT_RUN,
} from "../src/index.ts";
import {
  COMMAND_COMPLETED,
  HOOKS_LIST_WITH_USER_HOOK,
  INITIALIZE_REPLY,
  THREAD_START_REPLY,
  TURN_STARTED,
} from "./fixtures/codex-app-server-session.ts";

const spec: SessionSpec = {
  nodeId: "cas",
  cwd: "/work",
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: ["Bash(git:*)"], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

const ENDPOINT = {
  url: "http://127.0.0.1:4567/mcp",
  token: "tok-ork-secret-42",
};

const temp = (prefix: string): string =>
  mkdtempSync(path.join(tmpdir(), prefix));

/** An adapter whose secrets and system hooks file are in `root`. */
const adapterIn = (root: string) =>
  createCodexAppServerAdapter({
    secretRoot: root,
    systemHooks: path.join(root, "none.json"),
  });

const wireOf = (
  adapter: ReturnType<typeof createCodexAppServerAdapter>,
  session: SessionSpec,
  env: Record<string, string>,
) =>
  Promise.resolve().then(() =>
    adapter.mcp.wire(session, ENDPOINT, {
      waiting: () => {
        // Codex's wiring never waits.
      },
      signal: new AbortController().signal,
      env,
    }),
  );

const LEG = { endpoint: { url: "", token: "" }, allowed: [] };

/** `hooks/list`'s result listing `hooks` for one folder. */
const listed = (hooks: Record<string, unknown>[]) => ({
  data: [{ cwd: "/work", hooks, errors: [], warnings: [] }],
});

/** `hooks/list`'s reply listing `hooks`. */
const listing = (hooks: Record<string, unknown>[]): Frame => ({
  result: listed(hooks),
});

const ORK_HOOK = {
  key: "ork",
  eventName: "preToolUse",
  source: "sessionFlags",
  enabled: true,
};

/** A leg's codec from the adapter, for `leg`. */
const codecOf = (leg: SessionSpec): Codec => {
  const codec = codexAppServerAdapter.protocol?.(leg);
  if (codec === undefined) throw new Error("no codec");
  return codec;
};

/** The id of the `method` request among `frames`. */
const idOf = (frames: readonly Frame[] | undefined, method: string): string =>
  String(frames?.find(frame => frame["method"] === method)?.["id"]);

/** Plays the handshake up to `hooks/list`'s request; returns its frames. */
const toHooksList = (codec: Codec, leg: SessionSpec): DecodedFrame => {
  const [initialize] = codec.open(leg, LEG);
  return codec.decode({ ...INITIALIZE_REPLY, id: initialize?.id });
};

/** Plays the handshake through `hooks/list` answered with `reply`. */
const throughFence = (
  codec: Codec,
  leg: SessionSpec,
  reply: Frame,
): DecodedFrame => {
  const opened = toHooksList(codec, leg);
  return codec.decode({ ...reply, id: idOf(opened.write, "hooks/list") });
};

const finished = (events: readonly RuntimeEvent[]) =>
  events.filter(event => event.type === "session.finished");

describe("the codex-app-server adapter's legs", () => {
  it("starts app-server with plugins and apps off, the sandbox and approval policy, and no prompt", () => {
    expect(codexAppServerArgs(spec)).toEqual([
      "app-server",
      "--disable",
      "plugins",
      "--disable",
      "apps",
      "--disable",
      "remote_plugin",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      'approval_policy="on-request"',
    ]);
  });

  it("passes none of exec's flags, never a bypass or a wider sandbox", () => {
    const all = [
      spec,
      { ...spec, yolo: true },
      { ...spec, resume: "th-1" },
      { ...spec, resume: "th-1", fork: true },
    ].flatMap(leg => codexAppServerArgs(leg));
    for (const flag of [
      "--ignore-user-config",
      "--ignore-rules",
      "--dangerously-bypass-hook-trust",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "exec",
    ]) {
      expect(all).not.toContain(flag);
    }
    expect(all.join(" ")).not.toContain("danger-full-access");
  });

  it("asks Ork about approvals, holds nothing, and opens with initialize at spawn", () => {
    const codec = codecOf(spec);
    expect(codexAppServerAdapter).toMatchObject({
      driver: "codex-app-server",
      command: { bin: "codex" },
      permissions: { kind: "callback", denyByDefault: true },
      usage: { dollars: false },
    });
    expect(codexAppServerAdapter.hold).toBeUndefined();
    expect(codexAppServerAdapter.command.input).toBeUndefined();
    expect(codec).toMatchObject({ readyAtSpawn: true, waitsForTurn: true });
    expect(
      codec.open(spec, LEG).map(request => request.frame["method"]),
    ).toEqual(["initialize"]);
  });
});

describe("the codex-app-server adapter's wiring", () => {
  it("passes Ork's MCP keys and the hook by -c, the token only in the environment", async () => {
    const wired = await wireOf(adapterIn(temp("ork-cas-root-")), spec, {
      CODEX_HOME: temp("ork-cas-home-"),
    });
    expect(wired.args).toContain(
      `mcp_servers.ork.bearer_token_env_var="${CODEX_TOKEN_VAR}"`,
    );
    expect(wired.args).toContain(
      `shell_environment_policy.exclude=["${CODEX_TOKEN_VAR}"]`,
    );
    expect(wired.args.some(arg => arg.startsWith("hooks.PreToolUse="))).toBe(
      true,
    );
    expect(wired.env).toEqual({ [CODEX_TOKEN_VAR]: ENDPOINT.token });
    expect(wired.args.join(" ")).not.toContain(ENDPOINT.token);
    await wired.release();
  });

  it("refuses a session when the user's Codex home has a hooks file", async () => {
    const home = temp("ork-cas-home-");
    writeFileSync(path.join(home, "hooks.json"), "{}");
    await expect(
      wireOf(adapterIn(temp("ork-cas-root-")), spec, { CODEX_HOME: home }),
    ).rejects.toThrow(`${path.join(home, "hooks.json")} exists`);
  });

  it("sends the hook's trust, the sandbox and the policy in the thread request, and no token", async () => {
    const wired = await wireOf(adapterIn(temp("ork-cas-root-")), spec, {
      CODEX_HOME: temp("ork-cas-home-"),
    });
    const thread = throughFence(codecOf(spec), spec, listing([ORK_HOOK]))
      .write?.[0];
    await wired.release();
    expect(thread).toMatchObject({
      method: "thread/start",
      params: {
        cwd: "/work",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        config: CODEX_APP_SERVER_CONFIG,
      },
    });
    expect(JSON.stringify(thread)).not.toContain(ENDPOINT.token);
  });
});

describe("the hook fence", () => {
  it("lists the hooks for the leg's folder after initialize, before any thread", () => {
    const opened = toHooksList(codecOf(spec), spec);
    expect(opened.write?.map(frame => frame["method"])).toEqual([
      "initialized",
      "hooks/list",
    ]);
    expect(opened.write?.[1]).toMatchObject({ params: { cwds: ["/work"] } });
  });

  it("refuses a leg whose Codex loads a hook Ork did not pass, naming where", () => {
    const decoded = throughFence(
      codecOf(spec),
      spec,
      HOOKS_LIST_WITH_USER_HOOK,
    );
    expect(decoded.write).toBeUndefined();
    expect(decoded.fail).toContain("/home/user/.codex/config.toml");
  });

  it("refuses a leg whose Codex did not load Ork's hook", () => {
    expect(hookFence(listed([]))).toContain(
      "did not load Ork's PreToolUse hook",
    );
    expect(hookFence({})).toContain("did not load Ork's PreToolUse hook");
  });

  it("lets a leg go on with Ork's hook alone, or beside a disabled one", () => {
    expect(hookFence(listed([ORK_HOOK]))).toBeUndefined();
    expect(
      hookFence(
        listed([ORK_HOOK, { ...ORK_HOOK, source: "project", enabled: false }]),
      ),
    ).toBeUndefined();
    expect(
      hookFence(listed([ORK_HOOK, { ...ORK_HOOK, source: "project" }])),
    ).toContain("project");
  });

  it("ends the leg failed when Codex refuses hooks/list", () => {
    const codec = codecOf(spec);
    const opened = toHooksList(codec, spec);
    const decoded = codec.decode({
      id: idOf(opened.write, "hooks/list"),
      error: { code: -32601, message: "unknown method" },
    });
    expect(decoded.fail).toBe("codex refused hooks/list: unknown method");
  });
});

describe("the codex-app-server canary", () => {
  it("ends a leg whose tool call the hook never saw, and decodes nothing after", () => {
    // No wiring: no hook file, so no call is ever counted.
    const codec = codecOf(spec);
    const fenced = throughFence(codec, spec, listing([ORK_HOOK]));
    codec.decode({
      ...THREAD_START_REPLY,
      id: idOf(fenced.write, "thread/start"),
    });
    codec.decode(TURN_STARTED);
    const tripped = codec.decode(COMMAND_COMPLETED);
    expect(finished(tripped.events)).toMatchObject([
      {
        outcome: {
          subtype: "error_driver",
          end: { kind: "driver_crashed" },
          errors: [HOOK_DID_NOT_RUN],
        },
      },
    ]);
    expect(codec.decode(TURN_STARTED)).toEqual({ events: [] });
  });
});
