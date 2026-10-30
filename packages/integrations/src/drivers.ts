/**
 * @file The Claude drivers Ork can run a session with, as descriptors: id,
 *   label and doctor check. `@krapht/ork-runtime-claude` registers a factory
 *   for each id, so adding a driver is one descriptor here and one factory
 *   there (ADR-022). Ork never handles the user's Claude login (ADR-004).
 */

import type { CheckResult, Env, Exec } from "./integration.ts";
import { field, firstLine, parseJson } from "./json.ts";

export type ClaudeDriver = {
  id: DriverId;
  label: string;
  doctor: (exec: Exec, env: Env) => Promise<CheckResult>;
};

const sdk: ClaudeDriver = {
  id: "sdk",
  label: "Claude Agent SDK, with an API key or a cloud provider",
  doctor: (_exec, env) => {
    const name = "claude (sdk driver)";
    const ok = (detail: string): Promise<CheckResult> =>
      Promise.resolve({ name, status: "ok", detail });
    if (env["CLAUDE_CODE_USE_BEDROCK"] === "1") return ok("Amazon Bedrock");
    if (env["CLAUDE_CODE_USE_VERTEX"] === "1") return ok("Google Vertex AI");
    if (env["CLAUDE_CODE_USE_FOUNDRY"] === "1") return ok("Microsoft Foundry");
    if ((env["ANTHROPIC_API_KEY"] ?? "") !== "") {
      return ok("ANTHROPIC_API_KEY is set");
    }
    return Promise.resolve({
      name,
      status: "warn",
      detail: "no API key or cloud provider",
      hint: "Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1) to use the SDK driver.",
    });
  },
};

const cli: ClaudeDriver = {
  id: "cli",
  label: "your own `claude` CLI, logged in by you",
  doctor: async exec => {
    const name = "claude (cli driver)";
    const version = await exec("claude", ["--version"]);
    if (!version.ok) {
      return {
        name,
        status: "warn",
        detail: "claude CLI not found",
        hint: "Install Claude Code to use the CLI driver.",
      };
    }
    const status = parseJson(
      (await exec("claude", ["auth", "status", "--json"])).stdout,
    );
    if (field(status, "loggedIn") !== true) {
      return {
        name,
        status: "warn",
        detail: `${firstLine(version.stdout)}, not logged in`,
        hint: "Run `claude auth login` yourself; Ork never handles your login.",
      };
    }
    const method = field(status, "authMethod");
    const provider = field(status, "apiProvider");
    const via = [method, provider]
      .filter(v => typeof v === "string")
      .join(", ");
    return {
      name,
      status: "ok",
      detail: `${firstLine(version.stdout)}, logged in${via === "" ? "" : ` (${via})`}`,
    };
  },
};

/** The registry of Claude drivers; the first is the default. */
export const CLAUDE_DRIVERS = [sdk, cli] as const;

export type DriverId = "sdk" | "cli";

/** The drivers' ids, for the workflow schema's `driver` field. */
export const DRIVER_IDS: readonly [DriverId, ...DriverId[]] = ["sdk", "cli"];
