/**
 * @file The `command-code` adapter (RFC-014): the user's own `cmd -p` with
 *   `--output-format json`, logged in by the user. Ork's MCP endpoint is an
 *   `ork` entry in the checkout's local scope, leased for the session (one
 *   session per checkout, `lease.ts`). The node's tool rules are a mod written
 *   for the session (`command-code-mod.ts`), so everything it did not allow is
 *   refused. Command Code takes no message mid-turn, holds no report to a
 *   schema (Ork's `report` tool does) and reports tokens, not dollars. Flags
 *   measured on 1.88.5 (specs/architecture.md, "Command Code").
 */

import type { SessionSpec } from "@krapht/ork-core";

import type { CliAdapter, McpWiring } from "../adapter.ts";
import { leaseWiring } from "../lease.ts";
import { commandCodeDecoder, commandCodeUsage } from "./command-code-events.ts";
import { writeMod } from "./command-code-mod.ts";

/**
 * The brief, with Ork's instructions before it on a session's first leg:
 * Command Code has no flag that adds to its system prompt. A resumed leg's
 * session already holds them.
 */
const queryOf = (spec: SessionSpec): string => {
  const text =
    spec.resume === undefined
      ? `${spec.systemAppend}\n\n${spec.prompt}`
      : spec.prompt;
  // `-p` takes an optional value: one starting with `-` would read as a flag.
  return text.startsWith("-") ? ` ${text}` : text;
};

/**
 * The `cmd` arguments for a session spec. `yolo`: Command Code prompts for
 * nothing, and the session's mod refuses what the node did not allow.
 */
export const commandCodeArgs = (spec: SessionSpec): string[] => {
  const args = [
    "-p",
    queryOf(spec),
    "--output-format",
    "json",
    "--permission-mode",
    "yolo",
    "--skip-onboarding",
    "--no-auto-update",
  ];
  if (spec.model !== undefined) args.push("--model", spec.model);
  if (spec.effort !== undefined) args.push("--effort", spec.effort);
  if (spec.maxTurns !== undefined) {
    args.push("--max-turns", String(spec.maxTurns));
  }
  if (spec.resume !== undefined) args.push("--resume", spec.resume);
  if (spec.resume !== undefined && spec.fork === true) {
    args.push("--fork-session");
  }
  return args;
};

const lease = leaseWiring({});

/** The lease on the checkout, and the session's mod beside it. */
const withMod: McpWiring = {
  kind: "lease",
  wire: async (spec, endpoint, hooks) => {
    const wired = await lease.wire(spec, endpoint, hooks);
    try {
      const mod = writeMod(spec);
      return {
        args: [...wired.args, "--mod", mod.file],
        env: wired.env,
        release: async () => {
          mod.remove();
          await wired.release();
        },
      };
    } catch (error) {
      await wired.release();
      throw error;
    }
  },
};

/** `cmd`, as the session runner's strategies. */
export const commandCodeAdapter: CliAdapter = {
  driver: "command-code",
  command: { bin: "cmd", args: spec => commandCodeArgs(spec) },
  decode: line => commandCodeDecoder()(line),
  decoder: commandCodeDecoder,
  mcp: withMod,
  permissions: { kind: "rules", denyByDefault: true },
  usage: commandCodeUsage,
  context: {
    instructions: ["AGENTS.md"],
    skills: ".commandcode/skills",
    agents: ".commandcode/agents",
    env: () => ({}),
  },
};
