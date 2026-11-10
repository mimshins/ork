/**
 * @file The agent drivers Ork can run a session with, as descriptors: id, label
 *   and doctor check (RFC-014: `claude-code`, `open-code` and `command-code`,
 *   each proven on a real session). `@krapht/ork-runtime` registers a factory
 *   for each id, so adding a driver is one descriptor here and one factory
 *   there (ADR-022). Ork never handles the user's login (ADR-004).
 */

import type { CheckResult, Env, Exec } from "./integration.ts";
import { field, firstLine, parseJson } from "./json.ts";

/**
 * What a driver does by itself. `false` means Ork supplies a fallback (a
 * permission rule set, the `report` tool, delivery at the next leg) or refuses
 * the node that needs it, in `ork validate` and `ork run` (RFC-014).
 */
export type DriverCapabilities = {
  /** The model reaches Ork's MCP tools: `ask_user`, `delegate`, messages. */
  questions: boolean;
  /** The tool asks Ork, mid-session, before it runs a tool call. */
  permissionPrompt: boolean;
  /** The tool reports dollars, so `budgetUsd` can be enforced. */
  price: boolean;
  /** A message sent mid-turn reaches the model before the turn ends. */
  midTurnMessages: boolean;
  /** The tool validates its final answer against a JSON Schema. */
  reportSchema: boolean;
  /** The tool stops after a given number of turns (`maxTurns`). */
  turnLimit: boolean;
  /** The session loads the node's own MCP servers from `.mcp.json` (`mcp`). */
  mcpServers: boolean;
};

export type AgentDriver = {
  id: DriverId;
  label: string;
  doctor: (exec: Exec, env: Env) => Promise<CheckResult>;
  capabilities: DriverCapabilities;
  /**
   * Whether a maintainer's real, capped session has run on it. Until then no
   * run takes it and `ork validate` refuses a node that names it.
   */
  proven: boolean;
  /**
   * The tool holds one session per checkout at a time (Command Code's
   * per-folder MCP entry): a second session in the same checkout waits, and
   * `ork validate` warns where a workflow could queue that way.
   */
  onePerCheckout: boolean;
};

/**
 * The first Claude Code that reads AGENTS.md in every session (when there is no
 * CLAUDE.md); Ork relies on it rather than adding AGENTS.md itself.
 */
export const MIN_CLAUDE_VERSION = "2.1.281";

/** Whether `claude --version` output names a version below `min`. */
export const olderThan = (text: string, min: string): boolean => {
  const found = /(\d+)\.(\d+)\.(\d+)/u.exec(text);
  if (found === null) return false;
  const have = found.slice(1).map(Number);
  const want = min.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
};

/**
 * The credential `claude` runs with besides its own login, named for `ork
 * doctor`: an API key or a cloud provider's switch (ADR-004).
 */
export const envCredential = (env: Env): string | null => {
  if (env["CLAUDE_CODE_USE_BEDROCK"] === "1") {
    return "Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK)";
  }
  if (env["CLAUDE_CODE_USE_VERTEX"] === "1") {
    return "Google Vertex AI (CLAUDE_CODE_USE_VERTEX)";
  }
  if (env["CLAUDE_CODE_USE_FOUNDRY"] === "1") {
    return "Microsoft Foundry (CLAUDE_CODE_USE_FOUNDRY)";
  }
  if ((env["ANTHROPIC_API_KEY"] ?? "") !== "")
    return "ANTHROPIC_API_KEY is set";
  return null;
};

/**
 * How a logged-in `claude` says it is logged in, e.g. `(claude.ai,
 * firstParty)`.
 */
const loginDetail = (status: unknown): string => {
  const via = [field(status, "authMethod"), field(status, "apiProvider")]
    .filter(v => typeof v === "string")
    .join(", ");
  return `logged in${via === "" ? "" : ` (${via})`}`;
};

const claudeCode: AgentDriver = {
  id: "claude-code",
  label:
    "your own `claude` CLI, with its login, an API key or a cloud provider",
  capabilities: {
    questions: true,
    permissionPrompt: true,
    price: true,
    midTurnMessages: true,
    reportSchema: true,
    turnLimit: true,
    mcpServers: true,
  },
  proven: true,
  onePerCheckout: false,
  doctor: async (exec, env) => {
    const name = "claude (claude-code driver)";
    const version = await exec("claude", ["--version"]);
    if (!version.ok) {
      return {
        name,
        status: "warn",
        detail: "claude CLI not found",
        hint: "Install Claude Code to use the claude-code driver.",
      };
    }
    const status = parseJson(
      (await exec("claude", ["auth", "status", "--json"])).stdout,
    );
    const credential =
      field(status, "loggedIn") === true
        ? loginDetail(status)
        : envCredential(env);
    if (credential === null) {
      return {
        name,
        status: "warn",
        detail: `${firstLine(version.stdout)}, not logged in`,
        hint: "Run `claude auth login` yourself, or set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1 / CLAUDE_CODE_USE_FOUNDRY=1); Ork never handles your login.",
      };
    }
    if (olderThan(version.stdout, MIN_CLAUDE_VERSION)) {
      return {
        name,
        status: "warn",
        detail: `${firstLine(version.stdout)}, older than ${MIN_CLAUDE_VERSION}`,
        hint: "Update Claude Code: older versions may not read AGENTS.md, which Ork leaves to Claude Code.",
      };
    }
    return {
      name,
      status: "ok",
      detail: `${firstLine(version.stdout)}, ${credential}`,
    };
  },
};

/**
 * A driver whose tool Ork finds by `<program> --version`. While `proven` is
 * false its check is `skip`, never `ok`, so `readyDriver` never takes it and
 * `ork doctor` does not count it as a ready driver. Its login is the tool's own
 * and never read (ADR-004), so the detail only names the command to run.
 */
const installedCli = (
  id: DriverId,
  program: string,
  login: string,
  rest: Pick<
    AgentDriver,
    "label" | "capabilities" | "proven" | "onePerCheckout"
  >,
): AgentDriver => ({
  id,
  ...rest,
  doctor: async exec => {
    const name = `${program} (${id} driver)`;
    const version = await exec(program, ["--version"]);
    const unproven = rest.proven
      ? ""
      : ", unproven: not yet proven on a real session";
    // Another driver is optional: a missing tool is a skip, not a warning.
    if (!version.ok) {
      return {
        name,
        status: "skip",
        detail: `${program} CLI not found${unproven}`,
        // No hint while unproven: it would show under "no driver is ready".
        ...(rest.proven
          ? { hint: `Install ${program} to use the ${id} driver.` }
          : {}),
      };
    }
    return {
      name,
      status: rest.proven ? "ok" : "skip",
      detail: `${firstLine(version.stdout)}${unproven}; sign in with \`${login}\` if a session asks`,
    };
  },
});

const openCode = installedCli("open-code", "opencode", "opencode auth login", {
  label: "the `opencode` CLI",
  proven: true,
  onePerCheckout: false,
  // Proven on a real session (2026-11-10): Ork's tools reach the model with
  // Code Mode off, and the agent's `steps` caps the turns.
  capabilities: {
    questions: true,
    permissionPrompt: false,
    price: true,
    midTurnMessages: false,
    reportSchema: false,
    turnLimit: true,
    mcpServers: true,
  },
});

const commandCode = installedCli("command-code", "cmd", "cmd login", {
  label: "the `cmd` CLI of Command Code",
  proven: true,
  onePerCheckout: true,
  capabilities: {
    questions: true,
    permissionPrompt: false,
    price: false,
    midTurnMessages: false,
    reportSchema: false,
    turnLimit: true,
    // Its MCP servers come from a per-folder scope, which holds only Ork's.
    mcpServers: false,
  },
});

/**
 * The registry of agent drivers, in the order `ork doctor` lists them. None is
 * a default: a run takes the one ready here (`ready.ts`), and never one that is
 * not `proven`.
 */
export const AGENT_DRIVERS = [claudeCode, openCode, commandCode] as const;

export type DriverId = "claude-code" | "open-code" | "command-code";

/** The drivers' ids, for the workflow schema's `driver` field. */
export const DRIVER_IDS: readonly [DriverId, ...DriverId[]] = [
  "claude-code",
  "open-code",
  "command-code",
];

/**
 * The ids RFC-014 retired, and the one that replaces each: refused in a
 * workflow, a project file and `--driver`, read as it in a stored run.
 */
export const RETIRED_DRIVERS: Readonly<Record<string, DriverId>> = {
  sdk: "claude-code",
  cli: "claude-code",
};
