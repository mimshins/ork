/**
 * @file Reading an MCP server's definition from the project's `.mcp.json`, the
 *   file Claude Code reads too, so a server is defined in one place (RFC-006).
 *   `${VAR}` and `${VAR:-default}` read the user's environment, which is where
 *   secrets stay: Ork stores none, and a run masks each value read this way. A
 *   server that needs an OAuth sign-in holds Claude Code's tokens, not Ork's,
 *   so it is refused.
 */

import {
  type Environ,
  MCP_FILE,
  mcpNotText,
  readEnv,
  serversIn,
  type SessionSpec,
} from "@krapht/ork-core";
import type { Workflow } from "@krapht/ork-schema";

const VARIABLE = /\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}/gu;

export type McpServer =
  | {
      kind: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | { kind: "http"; url: string; headers: Record<string, string> };

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringsOf = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          typeof item === "string" ? [[key, item] as const] : [],
        ),
      )
    : {};

const listOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(item => (typeof item === "string" ? [item] : []))
    : [];

/** The server as written, or why Ork can't call it. */
export const readMcpServer = (root: string, name: string): Read<McpServer> => {
  const servers = serversIn(root);
  if (!servers.ok) return servers;
  const known = Object.keys(servers.value);
  const server = Object.hasOwn(servers.value, name)
    ? servers.value[name]
    : undefined;
  if (!isRecord(server)) {
    return {
      ok: false,
      error: `no MCP server \`${name}\` in ${MCP_FILE}${known.length === 0 ? "" : `, which has ${known.join(", ")}`}`,
    };
  }
  if ("oauth" in server) {
    return {
      ok: false,
      error: `MCP server \`${name}\` signs in with OAuth, whose tokens are Claude Code's: give it a token through headers and \`env:\`, or call it from a session`,
    };
  }
  const notText = mcpNotText(server);
  if (notText !== undefined) {
    return {
      ok: false,
      error: `MCP server \`${name}\` has a value in ${notText} that isn't a string: write it in quotes`,
    };
  }
  const { type, url, command } = server;
  if (type === "http" && typeof url === "string") {
    return {
      ok: true,
      value: { kind: "http", url, headers: stringsOf(server["headers"]) },
    };
  }
  if ((type === undefined || type === "stdio") && typeof command === "string") {
    return {
      ok: true,
      value: {
        kind: "stdio",
        command,
        args: listOf(server["args"]),
        env: stringsOf(server["env"]),
      },
    };
  }
  return {
    ok: false,
    error: `MCP server \`${name}\` is not one Ork can call: it takes stdio and http servers`,
  };
};

/**
 * The named servers' entries as written, for a session: `${VAR}` stays text for
 * the `claude` that loads them to expand. The compiler has checked the names.
 */
export const namedMcpEntries = (
  root: string,
  names: readonly string[],
): Read<Pick<SessionSpec, "mcpServers">> => {
  if (names.length === 0) return { ok: true, value: {} };
  const servers = serversIn(root);
  if (!servers.ok) return servers;
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const name of names) {
    const server = Object.hasOwn(servers.value, name)
      ? servers.value[name]
      : undefined;
    if (!isRecord(server)) {
      return { ok: false, error: `no MCP server \`${name}\` in ${MCP_FILE}` };
    }
    mcpServers[name] = server;
  }
  return { ok: true, value: { mcpServers } };
};

/** Each variable a server reads, and whether it has a default. */
const readsOf = (server: McpServer): { name: string; fallback: boolean }[] => {
  const texts =
    server.kind === "stdio"
      ? [server.command, ...server.args, ...Object.values(server.env)]
      : [server.url, ...Object.values(server.headers)];
  return texts.flatMap(text =>
    [...text.matchAll(VARIABLE)].map(match => ({
      name: String(match[1]),
      fallback: match[2] !== undefined,
    })),
  );
};

/**
 * The server with its variables filled in, and the values to mask: all it read
 * but those `plain` names, which aren't secret.
 */
export const expandServer = (
  server: McpServer,
  environ: Environ,
  plain: readonly string[] = [],
): Read<{ server: McpServer; values: string[] }> => {
  const unset = readsOf(server).find(
    ({ name, fallback }) => !fallback && readEnv(environ, name) === undefined,
  );
  if (unset !== undefined) {
    return {
      ok: false,
      error: `${MCP_FILE} reads ${unset.name}, which is not set`,
    };
  }
  const values: string[] = [];
  const fill = (text: string): string =>
    text.replaceAll(VARIABLE, (_all, name: string, fallback?: string) => {
      const value = readEnv(environ, name);
      if (value !== undefined && !plain.includes(name)) values.push(value);
      return value ?? fallback ?? "";
    });
  const fillAll = (record: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record).map(([key, text]) => [key, fill(text)]),
    );
  const filled: McpServer =
    server.kind === "stdio"
      ? {
          kind: "stdio",
          command: fill(server.command),
          args: server.args.map(arg => fill(arg)),
          env: fillAll(server.env),
        }
      : {
          kind: "http",
          url: fill(server.url),
          headers: fillAll(server.headers),
        };
  return { ok: true, value: { server: filled, values } };
};

/** What a workflow's MCP servers read of the user's, unless called not secret. */
export const mcpVariablesOf = (workflow: Workflow, root: string): string[] =>
  Object.values(workflow.nodes).flatMap(node => {
    if (node.type !== "mcp.call") return [];
    const read = readMcpServer(root, node.server);
    return read.ok
      ? readsOf(read.value)
          .map(({ name }) => name)
          .filter(name => node.plainEnv?.includes(name) !== true)
      : [];
  });

/** A stdio server's program, when its name can be known before it is filled in. */
const programOf = (server: McpServer): string | undefined =>
  server.kind === "stdio" && !server.command.includes("$")
    ? server.command
    : undefined;

/**
 * What stops a workflow's `mcp.call` nodes, found before a run spends anything:
 * a server that isn't there or can't be called, a program that isn't installed,
 * or a variable that is not set.
 */
export const mcpProblems = (
  workflow: Workflow,
  root: string,
  environ: Environ = process.env,
  finished: ReadonlySet<string> = new Set(),
  installed: (program: string) => boolean = () => true,
): string[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) => {
    if (node.type !== "mcp.call" || finished.has(id)) return [];
    const read = readMcpServer(root, node.server);
    if (!read.ok) return [`${id}: ${read.error}`];
    const given = new Set(Object.keys(node.env ?? {}));
    const unset = readsOf(read.value).flatMap(({ name, fallback }) =>
      fallback || given.has(name) || readEnv(environ, name) !== undefined
        ? []
        : [`${id}: ${MCP_FILE} reads ${name}, which is not set`],
    );
    const program = programOf(read.value);
    return program === undefined || installed(program)
      ? unset
      : [
          `\`${id}\`: MCP server \`${node.server}\` runs \`${program}\`, which is not installed`,
        ].concat(unset);
  });
