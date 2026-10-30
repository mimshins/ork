/**
 * @file A minimal MCP server over the streamable HTTP transport, for the
 *   `claude` CLI driver. It answers with plain JSON (no SSE stream), which the
 *   transport allows, and implements only what Ork needs: `initialize`, `ping`,
 *   `tools/list` and `tools/call`.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { z } from "zod";

import { type BoundTool, ORK_SERVER } from "./tools/tool.ts";

export type OrkMcpEndpoint = {
  url: string;
  token: string;
  close: () => Promise<void>;
};

const PATH = "/mcp";
const MAX_BODY = 1024 * 1024;
export const MCP_PROTOCOL_FALLBACK = "2025-06-18";

const JsonRpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

type RpcReply =
  | { result: unknown }
  | { error: { code: number; message: string } };

/** Handles one JSON-RPC request; `null` for a notification (no reply). */
export const handleRpc = async (
  tools: readonly BoundTool[],
  message: unknown,
): Promise<RpcReply | null> => {
  const parsed = JsonRpcSchema.safeParse(message);
  if (!parsed.success) {
    return { error: { code: -32_600, message: "invalid request" } };
  }
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;
  switch (method) {
    case "initialize": {
      const requested = params?.["protocolVersion"];
      return {
        result: {
          protocolVersion:
            typeof requested === "string" ? requested : MCP_PROTOCOL_FALLBACK,
          capabilities: { tools: {} },
          serverInfo: { name: ORK_SERVER, version: "0.0.0" },
        },
      };
    }
    case "ping": {
      return { result: {} };
    }
    case "tools/list": {
      return {
        result: {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: z.toJSONSchema(t.schema),
          })),
        },
      };
    }
    case "tools/call": {
      const tool = tools.find(t => t.name === params?.["name"]);
      if (tool === undefined) {
        return { error: { code: -32_602, message: "unknown tool" } };
      }
      try {
        return { result: await tool.call(params?.["arguments"] ?? {}) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "tool failed";
        return {
          result: { content: [{ type: "text", text: reason }], isError: true },
        };
      }
    }
    default: {
      return { error: { code: -32_601, message: `unknown method ${method}` } };
    }
  }
};

const authorized = (req: IncomingMessage, token: string): boolean => {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(req.headers.authorization ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const readBody = async (req: IncomingMessage): Promise<string | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const respond = (res: ServerResponse, status: number, body?: unknown): void => {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify(body));
};

const serve = async (
  req: IncomingMessage,
  res: ServerResponse,
  tools: readonly BoundTool[],
  token: string,
): Promise<void> => {
  if (!authorized(req, token)) {
    respond(res, 401);
    return;
  }
  if (req.url !== PATH) {
    respond(res, 404);
    return;
  }
  // No server-initiated stream: GET is not offered, DELETE ends nothing.
  if (req.method !== "POST") {
    respond(res, 405);
    return;
  }
  const body = await readBody(req);
  if (body === null) {
    respond(res, 413);
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    {
      respond(res, 400);
      return;
    }
  }
  const id: unknown =
    message !== null && typeof message === "object" && "id" in message
      ? message.id
      : null;
  const reply = await handleRpc(tools, message);
  if (reply === null) {
    respond(res, 202);
    return;
  }
  respond(res, 200, { jsonrpc: "2.0", id, ...reply });
};

/**
 * Serves Ork's tools to one `claude` CLI session: on 127.0.0.1 only, on a
 * random port, behind a per-session bearer token.
 */
export const startOrkMcpHttp = async (
  tools: readonly BoundTool[],
): Promise<OrkMcpEndpoint> => {
  const token = randomBytes(24).toString("hex");
  const http = createServer((req, res) => {
    serve(req, res, tools, token).catch(() => {
      if (!res.headersSent) respond(res, 500);
    });
  });
  await new Promise<void>(resolve => {
    http.listen(0, "127.0.0.1", resolve);
  });
  const address = http.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}${PATH}`,
    token,
    close: () =>
      new Promise(resolve => {
        http.closeAllConnections();
        http.close(() => {
          resolve();
        });
      }),
  };
};
