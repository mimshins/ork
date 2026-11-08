/**
 * @file The project's `.mcp.json`, the file Claude Code reads too, so a server
 *   is defined in one place: reading its servers, and the compiler's check of
 *   the servers a Claude node names (`mcp:`, ADR-067). A session's servers are
 *   read with the file's text left as written, so no value leaves the file.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Diagnostic, Workflow } from "@krapht/ork-schema";

export const MCP_FILE = ".mcp.json";

/** Ork's own MCP server: a project can't redefine it. */
const ORK_MCP_NAME = "ork";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The file's `mcpServers`; `{}` when there is no file. */
export const serversIn = (
  root: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } => {
  const file = path.join(root, MCP_FILE);
  if (!existsSync(file)) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const servers = isRecord(parsed) ? parsed["mcpServers"] : undefined;
    return { ok: true, value: isRecord(servers) ? servers : {} };
  } catch (error) {
    // The parser's own message quotes the text, which may hold a secret.
    const reason =
      error instanceof SyntaxError
        ? "it is not valid JSON"
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, error: `${MCP_FILE} can't be read: ${reason}` };
  }
};

/** A server's field that holds something other than text: it would be dropped. */
export const mcpNotText = (
  server: Record<string, unknown>,
): string | undefined =>
  ["args", "env", "headers"].find(field => {
    const value = server[field];
    const items = Array.isArray(value)
      ? value
      : isRecord(value)
        ? Object.values(value)
        : [];
    return items.some(item => typeof item !== "string");
  });

/** Why an entry can't be loaded, whatever its name; its values aren't quoted. */
const entryProblem = (server: unknown): string | undefined => {
  if (!isRecord(server)) return "it is not an object";
  if (server["args"] !== undefined && !Array.isArray(server["args"])) {
    return "its args is not a list";
  }
  const notRecord = ["env", "headers"].find(
    field => server[field] !== undefined && !isRecord(server[field]),
  );
  if (notRecord !== undefined) return `its ${notRecord} is not an object`;
  const field = mcpNotText(server);
  if (field !== undefined) return `its ${field} holds a value that isn't text`;
  return typeof server["command"] === "string" ||
    typeof server["url"] === "string"
    ? undefined
    : "it has neither a command nor a url";
};

export type McpOptions = {
  /** The names in `.mcp.json`. Omitted (no project), nothing is checked. */
  mcpServers?: readonly string[];
  /** Why there are no names: the file is missing or can't be read. */
  mcpFileProblem?: string;
  /** The entries that can't load, and why, by name. */
  mcpMalformed?: Readonly<Record<string, string>>;
};

/** What the compiler checks a workflow's `mcp:` names against. */
export const mcpFileOptions = (root: string): McpOptions => {
  const read = serversIn(root);
  if (!read.ok) return { mcpServers: [], mcpFileProblem: read.error };
  if (!existsSync(path.join(root, MCP_FILE))) {
    return { mcpServers: [], mcpFileProblem: `there is no ${MCP_FILE}` };
  }
  return {
    mcpServers: Object.keys(read.value),
    mcpMalformed: Object.fromEntries(
      Object.entries(read.value).flatMap(([name, server]) => {
        const problem = entryProblem(server);
        return problem === undefined ? [] : [[name, problem] as const];
      }),
    ),
  };
};

/** The error for one name a node gave, or nothing when it can load. */
const nameProblem = (
  id: string,
  name: string,
  options: McpOptions,
  known: readonly string[],
): Pick<Diagnostic, "code" | "message"> | undefined => {
  if (name === ORK_MCP_NAME) {
    return {
      code: "mcp.reserved",
      message: `\`${id}\`: \`${ORK_MCP_NAME}\` is Ork's own server, name another`,
    };
  }
  if (!known.includes(name)) {
    const where =
      options.mcpFileProblem === undefined
        ? ` in ${MCP_FILE}, which has ${known.length === 0 ? "none" : known.join(", ")}`
        : `: ${options.mcpFileProblem}`;
    return {
      code: "mcp.unknown",
      message: `\`${id}\`: no MCP server \`${name}\`${where}`,
    };
  }
  const problem = Object.hasOwn(options.mcpMalformed ?? {}, name)
    ? options.mcpMalformed?.[name]
    : undefined;
  return problem === undefined
    ? undefined
    : {
        code: "mcp.malformed",
        message: `\`${id}\`: MCP server \`${name}\` in ${MCP_FILE} is malformed: ${problem}`,
      };
};

/** Every server a Claude node's sessions would load exists and can load. */
export const checkMcpServers = (
  workflow: Workflow,
  options: McpOptions,
): Diagnostic[] => {
  const known = options.mcpServers;
  if (known === undefined) return [];
  return Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "claude.leader" && node.type !== "claude.worker") {
      return [];
    }
    const own = node.mcp !== undefined;
    const names = node.mcp ?? workflow.defaults?.mcp ?? [];
    return names.flatMap((name, index) => {
      const problem = nameProblem(id, name, options, known);
      return problem === undefined
        ? []
        : [
            {
              severity: "error" as const,
              ...problem,
              path: own
                ? ["nodes", id, "mcp", index]
                : ["defaults", "mcp", index],
            },
          ];
    });
  });
};
