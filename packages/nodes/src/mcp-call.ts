/**
 * @file The `mcp.call` node type (RFC-006): calls one named tool on one MCP
 *   server, with no session and so no model turn. The server comes from the
 *   project's `.mcp.json` (`mcp-servers.ts`), its secrets from the user's
 *   environment. The workflow's author named the tool, so this asks for no
 *   permission, as a tool node does not.
 */

import {
  evaluate,
  declaredProblem,
  type ExecuteContext,
  type NodeExecutor,
  type NodeResult,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { expandServer, type McpServer, readMcpServer } from "./mcp-servers.ts";
import {
  type Environ,
  renderEnv,
  secretsOf,
  withoutIdentity,
} from "./tool-env.ts";
import { keepFile, parseScrubbed, scrubbed } from "./tool-output.ts";
import { scrubberOf } from "./tool-scrub.ts";
import { capped, clipError, OUTPUT_LIMIT } from "./tools.ts";

/** A node's `timeout:` is what limits a call; this only lifts the SDK's 60 s. */
const NO_LIMIT_MS = 24 * 60 * 60 * 1000;

const failed = (error: string, output: Record<string, unknown> = {}) =>
  ({ ok: false, output, error }) satisfies NodeResult;

/** A failure another try might not have, so a `watch:` looks again. */
const missed = (error: string, output: Record<string, unknown> = {}) =>
  ({ ok: false, transient: true, output, error }) satisfies NodeResult;

/**
 * A string's templates rendered. A string that is one `{{ … }}` and nothing
 * else keeps its value's type, so a tool that asks for a number gets one.
 */
const renderValue = (
  value: unknown,
  scope: ReturnType<typeof runScope>,
): unknown => {
  if (typeof value === "string") {
    const template = parseTemplate(value);
    if (!template.ok) return value;
    const [only, ...rest] = template.parts;
    if (only !== undefined && typeof only !== "string" && rest.length === 0) {
      return evaluate(only.expr, scope);
    }
    return renderTemplate(template.parts, scope);
  }
  if (Array.isArray(value)) return value.map(item => renderValue(item, scope));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderValue(item, scope),
      ]),
    );
  }
  return value;
};

const transportFor = (
  server: McpServer,
  context: ExecuteContext,
  environ: Environ,
  env: Record<string, string>,
) =>
  server.kind === "stdio"
    ? new StdioClientTransport({
        command: server.command,
        args: server.args,
        // What a program inherits, as `claude` gives its servers.
        env: { ...withoutIdentity(environ), ...env, ...server.env },
        cwd: context.projectRoot,
        stderr: "ignore",
      })
    : new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      });

/** The text of a tool's result; what is not text is named, not dropped silently. */
const textOf = (content: unknown): string =>
  (Array.isArray(content) ? content : [])
    .map((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string"
        ? part.text
        : `[${String(part.type)} content]`,
    )
    .join("\n");

/** The result as JSON, read before masking so a masked number stays valid. */
const jsonOf = (
  structured: unknown,
  text: string,
  scrub: (text: string) => string,
): unknown => {
  try {
    return parseScrubbed(
      structured === undefined ? text : JSON.stringify(structured),
      scrub,
    );
  } catch {
    return undefined;
  }
};

const reasonOf = (error: unknown, server: string): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return code === 401 || error?.constructor.name === "UnauthorizedError"
    ? `MCP server "${server}" asks for a sign-in: give it a token through headers and env:, or call it from a session`
    : message;
};

export const mcpCallExecutor =
  (
    options: { environ?: Environ; maskedNames?: readonly string[] } = {},
  ): NodeExecutor =>
  async context => {
    const { node } = context;
    if (node.type !== "mcp.call") {
      return failed(`${context.id} is not an MCP call`);
    }
    const environ = options.environ ?? process.env;
    const declared = readMcpServer(context.projectRoot, node.server);
    if (!declared.ok) return failed(declared.error);
    const nodeEnv = renderEnv(node, context, environ);
    if (!nodeEnv.ok) return failed(nodeEnv.error);
    const expanded = expandServer(
      declared.value,
      { ...environ, ...nodeEnv.values },
      node.plainEnv,
    );
    if (!expanded.ok) return failed(expanded.error);
    const scrub = scrubberOf([
      ...secretsOf(context.workflow, environ, options.maskedNames),
      ...expanded.value.values,
    ]);
    const scope = runScope(context.inputs, context.outputs, context.runId);
    const args = Object.fromEntries(
      Object.entries(node.arguments ?? {}).map(([key, value]) => [
        key,
        renderValue(value, scope),
      ]),
    );
    const name = `${node.server}.${node.tool}`;
    context.emit({
      type: "tool.called",
      id: context.id,
      name,
      input: { arguments: scrubbed(args, scrub) },
    });
    const client = new Client({ name: "ork", version: "1" });
    try {
      await client.connect(
        transportFor(expanded.value.server, context, environ, nodeEnv.values),
        { signal: context.signal, timeout: NO_LIMIT_MS },
      );
      const result = await client.callTool(
        { name: node.tool, arguments: args },
        undefined,
        { signal: context.signal, timeout: NO_LIMIT_MS },
      );
      const raw = textOf(result.content);
      const said = scrub(raw);
      const text = capped(said, keepFile(context, "text", said));
      const json = jsonOf(result.structuredContent, raw, scrub);
      const tooLong = JSON.stringify(json ?? null).length > OUTPUT_LIMIT;
      const output: Record<string, unknown> = {
        text,
        ...(json === undefined || tooLong ? {} : { json }),
      };
      const reported = result.isError === true;
      const problem = declaredProblem(node.output?.schema, json);
      context.emit({
        type: "tool.result",
        id: context.id,
        isError: reported || tooLong || problem !== null,
      });
      if (reported) {
        return missed(`${name} failed: ${clipError(said)}`, output);
      }
      if (tooLong) return failed(`${name}'s result is over 64 KiB`, output);
      return problem === null ? { ok: true, output } : failed(problem, output);
    } catch (error) {
      context.emit({ type: "tool.result", id: context.id, isError: true });
      return missed(clipError(scrub(reasonOf(error, node.server))));
    } finally {
      await client.close().catch(() => {
        // Nothing is left to do with a connection that won't close.
      });
    }
  };
