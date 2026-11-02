/**
 * @file The server's `node:http` plumbing (ADR-039): JSON answers and bodies
 *   with a size limit, the headers every answer carries, and Server-Sent Event
 *   streams with a keep-alive comment.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** The largest request body read, in bytes. */
export const MAX_BODY = 1024 * 1024;

/** How often an open event stream gets a keep-alive comment. */
export const KEEP_ALIVE_MS = 15_000;

/** Sent with every answer: no sniffing, no framing, no referrer, no cache. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  res
    .writeHead(status, {
      ...BASE_HEADERS,
      ...headers,
      "content-type": "application/json; charset=utf-8",
    })
    .end(JSON.stringify(body));
};

export const sendError = (
  res: ServerResponse,
  status: number,
  error: string,
): void => {
  sendJson(res, status, { error });
};

export type ReadBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

/** Reads a JSON body; an empty body reads as `{}`. */
export const readJson = async (req: IncomingMessage): Promise<ReadBody> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY) {
      return { ok: false, status: 413, error: "The body is too large." };
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "The body is not valid JSON." };
  }
};

export type EventStream = {
  /** Sends one event; `data` is sent as JSON. */
  send: (event: string, data: unknown, id?: number) => void;
  /** Ends the stream. */
  close: () => void;
  /** Aborted when the client goes away or the stream is closed. */
  signal: AbortSignal;
};

/** Opens a Server-Sent Event stream on `res`. */
export const openEventStream = (
  res: ServerResponse,
  keepAliveMs: number = KEEP_ALIVE_MS,
): EventStream => {
  const abort = new AbortController();
  res.writeHead(200, {
    ...BASE_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
  });
  // Tells the browser how long to wait before it reconnects.
  res.write("retry: 1000\n\n");
  const timer = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, keepAliveMs);
  const close = (): void => {
    if (abort.signal.aborted) return;
    clearInterval(timer);
    abort.abort();
    res.end();
  };
  res.on("close", close);
  return {
    send: (event, data, id) => {
      if (abort.signal.aborted) return;
      const head = id === undefined ? "" : `id: ${String(id)}\n`;
      res.write(`${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
    signal: abort.signal,
  };
};
