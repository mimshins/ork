/**
 * @file Tests for the integration and driver registries: ids are unique and
 *   consistent, and adapters build their own arguments.
 */

import { describe, expect, it } from "vitest";

import {
  type AgentDriver,
  type Exec,
  aws,
  AGENT_DRIVERS,
  DRIVER_IDS,
  gh,
  git,
  INTEGRATIONS,
  integrationFor,
  MIN_CLAUDE_VERSION,
  MIN_CODEX_VERSION,
  MIN_OMP_VERSION,
  MIN_OPENCODE_VERSION,
  olderThan,
  ompDriver,
  readyDriver,
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
    expect(integrationFor("agent.worker")).toBeUndefined();
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
      AGENT_DRIVERS.slice(1, 3).map(d => d.doctor(answersAnything, {})),
    );
    expect(others.map(r => r.status)).toEqual(["ok", "ok"]);
    expect(others.some(r => r.detail.includes("unproven"))).toBe(false);
  });

  it("warns about an OpenCode older than the one that keeps Ork's tools out of Code Mode", async () => {
    const opencode = AGENT_DRIVERS.find(d => d.id === "open-code");
    const said = (stdout: string) =>
      opencode?.doctor(() => Promise.resolve({ ok: true, stdout }), {});
    expect(await said("opencode v2.1.0\n")).toMatchObject({
      status: "warn",
      detail: `opencode v2.1.0, older than ${MIN_OPENCODE_VERSION}`,
    });
    expect(await said("opencode v2.3.2\n")).toMatchObject({ status: "ok" });
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
      subagents: false,
      readDenies: true,
    });
    expect(command.capabilities).toEqual({
      questions: true,
      permissionPrompt: false,
      price: false,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: true,
      mcpServers: false,
      subagents: false,
      readDenies: true,
    });
  });
});

/**
 * `codex`'s check with a `codex` whose `--version` and `login status` answer as
 * given.
 */
const codexCheck = (version: string | null, loggedIn: boolean) => {
  const exec: Exec = (program, args) => {
    const call = [program, ...args].join(" ");
    if (call === "codex --version") {
      return Promise.resolve(
        version === null
          ? { ok: false, stdout: "" }
          : { ok: true, stdout: version },
      );
    }
    // Only the exit status counts: the output is never read.
    return Promise.resolve({
      ok: call === "codex login status" && loggedIn,
      stdout: "Logged in using ChatGPT",
    });
  };
  return AGENT_DRIVERS[3].doctor(exec, {});
};

describe("the codex driver", () => {
  it("is the fourth, proven, and declares what it does itself", () => {
    const codex = AGENT_DRIVERS[3];
    expect(codex.id).toBe("codex");
    expect([codex.proven, codex.onePerCheckout]).toEqual([true, false]);
    expect(codex.capabilities).toEqual({
      questions: true,
      permissionPrompt: false,
      price: false,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: false,
      mcpServers: false,
      subagents: false,
      readDenies: false,
    });
  });

  it("is skipped when codex is missing, saying how to get it", async () => {
    expect(await codexCheck(null, true)).toMatchObject({
      status: "skip",
      detail: "codex CLI not found",
      hint: "Install codex to use the codex driver.",
    });
  });

  it("warns about a codex older than the minimum", async () => {
    expect(await codexCheck("codex-cli 0.168.9\n", true)).toMatchObject({
      status: "warn",
      detail: `codex-cli 0.168.9, older than ${MIN_CODEX_VERSION}`,
    });
  });

  it("warns when logged out, saying how to sign in", async () => {
    expect(await codexCheck("codex-cli 0.169.0\n", false)).toMatchObject({
      status: "warn",
      detail: "codex-cli 0.169.0, not logged in; sign in with `codex login`",
      hint: "Sign in with `codex login`.",
    });
  });

  it("is ready when logged in, so a run may take it", async () => {
    const found = await codexCheck("codex-cli 0.169.0\n", true);
    expect(found).toMatchObject({
      status: "ok",
      detail: "codex-cli 0.169.0, logged in",
    });
    expect(readyDriver([{ id: "codex", result: found }])).toMatchObject({
      ok: true,
      driver: "codex",
    });
  });

  it("does not displace claude-code when both are ready", async () => {
    const found = await codexCheck("codex-cli 0.169.0\n", true);
    const claude = {
      name: "claude",
      status: "ok" as const,
      detail: "logged in",
    };
    expect(
      readyDriver([
        { id: "codex", result: found },
        { id: "claude-code", result: claude },
      ]),
    ).toMatchObject({ ok: true, driver: "claude-code" });
  });
});

/** A command that prints `stdout`, or fails on `null`. */
const answer = (stdout: string | null) =>
  Promise.resolve(
    stdout === null ? { ok: false, stdout: "" } : { ok: true, stdout },
  );

/** The `omp` driver, found by id so a reorder of the list cannot swap it. */
const listedOmp = (): AgentDriver => {
  const found = AGENT_DRIVERS.find(each => each.id === "omp");
  if (found === undefined) throw new Error("no omp driver in AGENT_DRIVERS");
  return found;
};

/**
 * `omp`'s check with an `omp` whose `--version` and `models --json` answer as
 * given (`null`: the command fails), on `driver` (the real one by default).
 * Returns the result and every command run.
 */
const ompCheck = async (
  version: string | null,
  models: string | null,
  driver: AgentDriver = listedOmp(),
) => {
  const calls: string[] = [];
  const exec: Exec = (program, args) => {
    const call = [program, ...args].join(" ");
    calls.push(call);
    return answer(call === "omp --version" ? version : models);
  };
  return { result: await driver.doctor(exec, {}), calls };
};

/** An entry of `omp models --json` as measured: `selector` is `provider/id`. */
const ompEntry = (provider: string, id: string) => ({
  provider,
  kind: "model",
  id,
  selector: `${provider}/${id}`,
  name: id,
});

const OMP_MODELS = JSON.stringify({
  models: [
    ompEntry("openai", "gpt-5.2"),
    ompEntry("anthropic", "claude-opus-5-5"),
  ],
});

/** `omp`'s model list, with an `omp` whose `models --json` prints `out`. */
const list = (out: string | null) =>
  listedOmp().models?.(() => answer(out), {});

describe("the omp driver", () => {
  it("is the fifth, not yet proven, and declares what it does itself", () => {
    const omp = listedOmp();
    expect(omp.id).toBe("omp");
    expect([omp.proven, omp.onePerCheckout]).toEqual([false, false]);
    expect(omp.capabilities).toEqual({
      questions: true,
      permissionPrompt: true,
      price: true,
      midTurnMessages: true,
      reportSchema: false,
      turnLimit: false,
      mcpServers: false,
      subagents: false,
      readDenies: true,
    });
    expect(MIN_OMP_VERSION).toBe("18.22.2");
  });

  it("is skipped with no hint when omp is missing, while unproven", async () => {
    const { result } = await ompCheck(null, OMP_MODELS);
    expect(result).toMatchObject({ status: "skip" });
    expect(result.detail).toContain("omp CLI not found");
    expect(result.hint).toBeUndefined();
  });

  it("warns about an omp older than the minimum, saying why", async () => {
    const { result } = await ompCheck("omp/18.22.1\n", OMP_MODELS);
    expect(result).toMatchObject({
      status: "warn",
      detail: `omp/18.22.1, older than ${MIN_OMP_VERSION}`,
    });
    expect(result.hint).toContain("Update omp");
  });

  it.each([
    ["no models", JSON.stringify({ models: [] })],
    ["a failed command", null],
    ["output that is not the JSON", "Error: no providers"],
  ])("is not logged in on %s, and skipped while unproven", async (_, out) => {
    const { result } = await ompCheck("omp/18.22.2\n", out);
    expect(result.status).toBe("skip");
    expect(result.detail).toContain("omp/18.22.2, not logged in");
    expect(result.detail).toContain("sign in with `omp login`");
    expect(result.hint).toBeUndefined();
  });

  it("is logged in with a count of models, skipped while unproven", async () => {
    const { result } = await ompCheck("omp/18.22.2\n", OMP_MODELS);
    expect(result.status).toBe("skip");
    expect(result.detail).toContain("omp/18.22.2, logged in (2 models)");
  });

  it("is ready once proven, so a run may take it", async () => {
    const proven = ompDriver(true);
    const one = JSON.stringify({ models: [ompEntry("openai", "gpt-5.2")] });
    const { result } = await ompCheck("omp/18.22.2\n", one, proven);
    expect(result).toMatchObject({
      status: "ok",
      detail: "omp/18.22.2, logged in (1 model)",
    });
  });

  it("runs only omp --version and omp models --json", async () => {
    const { calls } = await ompCheck("omp/18.22.2\n", OMP_MODELS);
    expect(calls).toEqual(["omp --version", "omp models --json"]);
  });

  it("lists the exact selectors, or null when it cannot", async () => {
    expect(await list(OMP_MODELS)).toEqual([
      "openai/gpt-5.2",
      "anthropic/claude-opus-5-5",
    ]);
    // No `selector`: `provider/id`; no usable parts: skipped.
    expect(
      await list(
        JSON.stringify({
          models: [{ provider: "fake", id: "m" }, { id: "bare" }],
        }),
      ),
    ).toEqual(["fake/m"]);
    expect(await list(null)).toBeNull();
    expect(await list("not json")).toBeNull();
    expect(await list(JSON.stringify({ models: [] }))).toBeNull();
    expect(await list(JSON.stringify({ models: [{ name: "x" }] }))).toBeNull();
  });

  it("is the only driver with a model list", () => {
    expect(AGENT_DRIVERS.filter(d => d.models !== undefined)).toHaveLength(1);
  });
});

describe("a sign-in a failed run asks for", () => {
  it("is read from gh's exit code and aws's words", () => {
    expect(gh.signedOut?.({ exitCode: 4, stderr: "" })).toBe(true);
    expect(gh.signedOut?.({ exitCode: 1, stderr: "not found" })).toBe(false);
    expect(
      aws.signedOut?.({
        exitCode: 255,
        stderr: "Unable to locate credentials. You can configure them.",
      }),
    ).toBe(true);
    expect(aws.signedOut?.({ exitCode: 254, stderr: "NoSuchBucket" })).toBe(
      false,
    );
  });
});
