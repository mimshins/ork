/**
 * @file The `open-code` adapter: the user's own `opencode run` (2.1.0), on a
 *   private server (`--standalone`; the background service would ignore the
 *   session's environment), started in the node's worktree, which pins its
 *   working folder. Ork's endpoint, the permission rules and the `ork` agent go
 *   in a config file named by `OPENCODE_CONFIG` (the `config-file` wiring),
 *   written at 0600 in a private folder outside the checkout and removed after
 *   the session (`secret-file.ts`). The machine's and the project's OpenCode
 *   config stay out: `XDG_CONFIG_HOME` is an empty folder beside the file, and
 *   the project's config is switched off. The brief and each later message are
 *   the message argument of a leg; a message waits for the next leg, which
 *   continues the session. Never `--auto`: it approves what no rule denies.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import type { CliAdapter, McpWiring } from "../adapter.ts";
import { makeSecretFolder, secretRoot } from "../secret-file.ts";
import { ORK_AGENT, sessionConfig } from "./open-code-config.ts";
import {
  decodeOpenCodeLine,
  openCodeDecoder,
  openCodeUsage,
} from "./open-code-events.ts";

/** The `opencode run` arguments for one leg; the message is the last one. */
export const openCodeArgs = (spec: SessionSpec): string[] => [
  "run",
  "--standalone",
  "--format",
  "json",
  "--agent",
  ORK_AGENT,
  ...(spec.model === undefined ? [] : ["--model", spec.model]),
  ...(spec.resume === undefined ? [] : ["--session", spec.resume]),
  ...(spec.resume !== undefined && spec.fork === true ? ["--fork"] : []),
  // A message starting with `-` would read as a flag.
  spec.prompt.startsWith("-") ? ` ${spec.prompt}` : spec.prompt,
];

/**
 * What keeps the machine's and the project's own OpenCode setup out, and
 * OpenCode's reading of `.claude/` and `CLAUDE.md` (RFC-014 open question 3).
 */
export const OPEN_CODE_ENV: Readonly<Record<string, string>> = {
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  // Both add config sources; the session's file is the only one.
  OPENCODE_CONFIG_DIR: "",
  OPENCODE_CONFIG_CONTENT: "",
};

/** The config file, Ork's instructions and an empty config home, per session. */
const configFile = (root: string): McpWiring => ({
  kind: "config-file",
  wire: (spec, endpoint) => {
    const folder = makeSecretFolder(root);
    try {
      const instructions = folder.write("ork.md", spec.systemAppend);
      const config = folder.write(
        "opencode.json",
        JSON.stringify(sessionConfig(spec, endpoint, instructions)),
      );
      const home = path.join(folder.dir, "config");
      mkdirSync(home, { mode: 0o700 });
      return Promise.resolve({
        args: [],
        env: { OPENCODE_CONFIG: config, XDG_CONFIG_HOME: home },
        release: () => {
          folder.remove();
          return Promise.resolve();
        },
      });
    } catch (error) {
      folder.remove();
      throw error;
    }
  },
});

export type OpenCodeOptions = {
  /** Where the sessions' private folders go; the system's temporary folder. */
  secretRoot?: string;
};

/** `opencode`, as the session runner's strategies. */
export const createOpenCodeAdapter = (
  options: OpenCodeOptions = {},
): CliAdapter => ({
  driver: "open-code",
  command: { bin: "opencode", args: openCodeArgs },
  decode: decodeOpenCodeLine,
  // No result line: a leg's decoder keeps what the session's end needs.
  legDecoder: openCodeDecoder,
  mcp: configFile(options.secretRoot ?? secretRoot()),
  permissions: { kind: "rules", denyByDefault: true },
  usage: openCodeUsage,
  context: {
    instructions: ["AGENTS.md"],
    skills: ".opencode/skills",
    agents: ".opencode/agents",
    env: () => OPEN_CODE_ENV,
  },
});

export const openCodeAdapter: CliAdapter = createOpenCodeAdapter();
