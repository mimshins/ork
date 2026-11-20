/**
 * @file The `omp` driver's session files (RFC-026): the built-ins a leg offers
 *   (`--tools`), the settings overlay (`--config`) that is the wall behind
 *   Ork's guard, the plugin folder (`--plugin-dir`) that carries Ork's MCP
 *   server, and the hold file the guard reads. `--tools` and the overlay's
 *   approvals come from one function, so the two cannot disagree: a tool is
 *   offered only when the node's rules can allow some call of it, and every
 *   other tool, `eval` and `task` among them, is denied. `omp` asks before any
 *   tool with no approval entry (in rpc mode it asks Ork, which a human then
 *   answers), so each Ork tool is allowed by its own name (a wildcard key does
 *   not work) and never needs asking. Everything is written in a private folder
 *   outside the checkout (0700, files 0600, `secret-file.ts`), removed when the
 *   session ends or a write fails.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";

import type { OrkEndpoint } from "../adapter.ts";
import { makeSecretFolder } from "../secret-file.ts";
import { ORK_TOOLS } from "../tools/registry.ts";
import { toolRuleSet } from "../tools/tool-rules-source.ts";
import { ORK_SERVER, toolId } from "../tools/tool.ts";
import { OMP_ORK_PREFIX, OMP_PLUGIN } from "./omp-names.ts";

/** The built-ins Ork may offer, in `omp`'s names. */
const BUILT_INS = ["read", "edit", "write", "bash", "grep", "glob"] as const;

/** `omp`'s read tools: they need no rule inside the worktree. */
const READS: readonly string[] = ["read", "grep", "glob"];

/** Never offered: `eval`'s helpers emit no `tool_call`, `task` runs in yolo. */
const NEVER = ["eval", "task"] as const;

/** Tools `plan` mode leaves out, as on `open-code`. */
const PLAN_OUT: ReadonlySet<string> = new Set(["edit", "write", "bash"]);

/** A rule's word, lower case, and the built-ins it covers. */
const COVERS: Readonly<Record<string, readonly string[]>> = {
  read: READS,
  grep: ["grep"],
  glob: ["glob"],
  edit: ["edit", "write"],
  write: ["edit", "write"],
  multiedit: ["edit", "write"],
  bash: ["bash"],
};

/**
 * Discovery sources of other tools' files and MCP servers, kept out of every
 * leg. Not `claude-plugins`: Ork's own plugin folder loads through it. Not
 * `native` (the user's own `omp` setup) nor `agents-md` (the repository's
 * `AGENTS.md`).
 */
const OTHER_TOOLS = [
  "claude",
  "claude-md",
  "agent-plugins",
  "agents",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "windsurf",
  "cline",
  "github",
  "vscode",
  "mcp-json",
];

/** A rule's word and whether it names a whole tool (no specifier, or `*`). */
const ruleOf = (rule: string): { word: string; whole: boolean } => {
  const at = rule.indexOf("(");
  if (at < 0 || !rule.endsWith(")")) {
    return { word: rule.trim().toLowerCase(), whole: true };
  }
  const spec = rule.slice(at + 1, -1).trim();
  return {
    word: rule.slice(0, at).trim().toLowerCase(),
    whole: spec === "" || spec === "*",
  };
};

const covers = (rule: string): readonly string[] =>
  COVERS[ruleOf(rule).word] ?? [];

/**
 * Whether a deny rule refuses every call of `tool`: a whole rule, or one with a
 * specifier the shared matcher can't read (it refuses all of those). Only a
 * shell prefix is read; a path-scoped read rule covers all three read tools, so
 * the node reads through `extract`, which applies the pattern.
 */
const deniesAll = (rule: string, tool: string): boolean => {
  const { word, whole } = ruleOf(rule);
  if (!whole && READS.includes(word)) return READS.includes(tool);
  return covers(rule).includes(tool) && (whole || tool !== "bash");
};

/** The built-ins the node's rules can allow some call of; maybe none. */
const offered = (spec: SessionSpec): string[] => {
  const rules = toolRuleSet(spec);
  return BUILT_INS.filter(
    tool =>
      !(spec.permissionMode === "plan" && PLAN_OUT.has(tool)) &&
      !rules.deny.some(rule => deniesAll(rule, tool)) &&
      (rules.only === undefined ||
        rules.only.some(rule => covers(rule).includes(tool))) &&
      (READS.includes(tool) ||
        rules.yolo === true ||
        rules.allow.some(rule => covers(rule).includes(tool))),
  );
};

/**
 * The `--tools` list. Never empty: an empty list was not measured beside MCP
 * tools, so a node with no built-in left gets `read`, which the overlay and the
 * guard deny.
 */
export const ompTools = (spec: SessionSpec): string[] => {
  const tools = offered(spec);
  return tools.length === 0 ? ["read"] : tools;
};

/** Whether the node's denies refuse Ork's tool `name` (the matcher's words). */
const orkDenied = (spec: SessionSpec, name: string): boolean =>
  spec.tools.deny.some(rule =>
    [toolId(name), toolId("*"), `mcp__${ORK_SERVER}`].includes(rule.trim()),
  );

/** `tools.approval`: allow what is offered and Ork's tools, deny the rest. */
const approvals = (spec: SessionSpec): Record<string, "allow" | "deny"> => {
  const tools = offered(spec);
  return {
    ...Object.fromEntries(
      BUILT_INS.map(tool => [tool, tools.includes(tool) ? "allow" : "deny"]),
    ),
    ...Object.fromEntries(NEVER.map(tool => [tool, "deny"])),
    ...Object.fromEntries(
      ORK_TOOLS.map(tool => [
        `${OMP_ORK_PREFIX}${tool.name}`,
        orkDenied(spec, tool.name) ? "deny" : "allow",
      ]),
    ),
  };
};

/**
 * The settings overlay for a leg. With a hold window, the guard's handler may
 * wait one window for a pause and one more for a `heavy` slot, so `omp`'s cut
 * is past both and only backs up an Ork that never answers.
 */
export const overlayOf = (
  spec: SessionSpec,
  holdWindowMs?: number,
): Record<string, unknown> => ({
  tools: { xdev: false, approvalMode: "always-ask", approval: approvals(spec) },
  ...(holdWindowMs === undefined
    ? {}
    : { extensionHandlers: { toolCallTimeoutMs: 2 * holdWindowMs + 60_000 } }),
  advisor: { enabled: false },
  spotlight: { experiment: { enabled: false } },
  prewalk: { auto: "off" },
  task: { autoParallel: "off" },
  retry: { modelFallback: false, waitForUsageReset: false },
  autoResume: false,
  async: { enabled: false },
  bash: { autoBackground: { enabled: false } },
  memory: { backend: "off" },
  startup: { checkUpdate: false },
  update: { auto: false },
  mcp: { enableProjectConfig: false },
  disabledProviders: OTHER_TOOLS,
});

const isMapping = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A mapping as block YAML, every value a JSON scalar or list (valid YAML), so a
 * string such as `off` stays a string and never reads as a boolean. Keys are
 * Ork's own, plain words.
 */
export const yamlOf = (value: Record<string, unknown>, indent = ""): string =>
  Object.entries(value)
    .map(([key, each]) =>
      isMapping(each)
        ? `${indent}${key}:\n${yamlOf(each, `${indent}  `)}`
        : `${indent}${key}: ${JSON.stringify(each)}\n`,
    )
    .join("");

/** The plugin folder's files, by path inside it; the token as a literal. */
export const pluginFiles = (endpoint: OrkEndpoint): Record<string, string> => ({
  ".claude-plugin/plugin.json": `${JSON.stringify(
    {
      name: OMP_PLUGIN,
      version: "0.0.0",
      description: "Ork's tools for this session",
    },
    null,
    2,
  )}\n`,
  ".mcp.json": `${JSON.stringify(
    {
      mcpServers: {
        [ORK_SERVER]: {
          type: "http",
          url: endpoint.url,
          headers: { Authorization: `Bearer ${endpoint.token}` },
        },
      },
    },
    null,
    2,
  )}\n`,
});

/** A session's files, by absolute path, and their removal. */
export type OmpSessionFiles = {
  dir: string;
  overlay: string;
  guard: string;
  plugin: string;
  /** Only when the session can be held. */
  hold?: string;
  remove: () => void;
};

export type OmpSessionOptions = {
  /**
   * The guard module's source (`omp-guard.ts`), written as `guard.mjs`; or a
   * function of the private folder, which the guard's source names.
   */
  guard: string | ((dir: string) => string);
  /** The hold window, used only when the endpoint has a hold URL. */
  holdWindowMs: number;
  /** Where the private folder goes (tests); the system's temporary folder. */
  root?: string;
};

/**
 * Writes a session's files in a fresh private folder: the plugin, the hold file
 * (with a hold endpoint), the overlay and the guard. A failure removes the
 * folder before it throws.
 */
export const writeOmpSession = (
  spec: SessionSpec,
  endpoint: OrkEndpoint,
  options: OmpSessionOptions,
): OmpSessionFiles => {
  const folder = makeSecretFolder(options.root);
  try {
    const plugin = path.join(folder.dir, "plugin");
    mkdirSync(path.join(plugin, ".claude-plugin"), {
      recursive: true,
      mode: 0o700,
    });
    for (const [name, content] of Object.entries(pluginFiles(endpoint))) {
      folder.write(path.join("plugin", name), content);
    }
    const hold =
      endpoint.holdUrl === undefined
        ? undefined
        : folder.write(
            "hold.json",
            JSON.stringify({ url: endpoint.holdUrl, token: endpoint.token }),
          );
    const window =
      endpoint.holdUrl === undefined ? undefined : options.holdWindowMs;
    return {
      dir: folder.dir,
      overlay: folder.write("overlay.yml", yamlOf(overlayOf(spec, window))),
      guard: folder.write(
        "guard.mjs",
        typeof options.guard === "string"
          ? options.guard
          : options.guard(folder.dir),
      ),
      plugin,
      ...(hold === undefined ? {} : { hold }),
      remove: folder.remove,
    };
  } catch (error) {
    folder.remove();
    throw error;
  }
};
