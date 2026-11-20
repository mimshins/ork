/**
 * @file Watching a protocol driver's process for the duplex leg (RFC-027): its
 *   stdout as lines with a byte bound, parsed as JSON frames and decoded by the
 *   codec without trusting it to hold; its stderr's tail; its exit; the
 *   requests waiting for responses; and the queue the leg awaits all of it on.
 */

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import {
  type Codec,
  type DecodedFrame,
  type Frame,
  MAX_FRAME_LINE_BYTES,
} from "./adapter.ts";
import { STDERR_TAIL } from "./leg-step.ts";

/** What the duplex leg waits on next. */
export type Item =
  | { kind: "line"; text: string }
  | { kind: "over" }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "error"; error: Error }
  | { kind: "fail"; reason: string }
  | { kind: "ready-late" }
  | { kind: "settle-late" };

/** A queue one consumer awaits, which callbacks and timers push to. */
export const inbox = <T>() => {
  const items: T[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let wake: (() => void) | undefined;
  const woken = () =>
    new Promise<void>(resolve => {
      wake = resolve;
    });
  const push = (item: T) => {
    items.push(item);
    wake?.();
    wake = undefined;
  };
  return {
    push,
    /** Pushes `item` in `ms`, unless cleared first. */
    later: (ms: number, item: T) => {
      timers.add(
        setTimeout(() => {
          push(item);
        }, ms),
      );
    },
    clear: () => {
      for (const timer of timers) clearTimeout(timer);
    },
    next: async (): Promise<T> => {
      for (;;) {
        const item = items.shift();
        if (item !== undefined) return item;
        // oxlint-disable-next-line eslint/no-await-in-loop -- one item at a time
        await woken();
      }
    },
  };
};

/**
 * Pushes the process's lines, a line over the bound, a failure to start and,
 * after every line, its exit to `box`; returns its stderr's tail so far.
 */
export const watched = (
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  box: { push: (item: Item) => void },
): (() => string) => {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  child.stdin.on("error", () => {
    // A write to a process that died (EPIPE): its exit explains the end.
  });
  const exited = new Promise<Item>(resolve => {
    child.on("close", (code, signal) => {
      resolve({ kind: "exit", code, signal });
    });
  });
  child.on("error", error => {
    box.push({ kind: "error", error });
  });
  const reading = (async () => {
    for await (const line of boundedLines(child.stdout, MAX_FRAME_LINE_BYTES)) {
      box.push(
        typeof line === "string"
          ? { kind: "line", text: line }
          : { kind: "over" },
      );
    }
  })().catch(() => null);
  void Promise.all([exited, reading]).then(([exit]) => {
    box.push(exit);
    return null;
  });
  return () => stderr;
};

type Waiting = { resolve: () => void; reject: (error: Error) => void };

/**
 * The requests Ork wrote that wait for their responses, by id: each settles
 * with its response, and every one left rejects at `close`, as does a later
 * one.
 */
export const requestTable = (ended: () => Error) => {
  const waiting = new Map<string, Waiting>();
  let closed = false;
  return {
    wait: (id: string): Promise<void> => {
      if (closed) return Promise.reject(ended());
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      waiting.set(id, { resolve, reject });
      return promise;
    },
    answered: ({ id, error }: { id: string; error?: string }) => {
      const request = waiting.get(id);
      waiting.delete(id);
      if (error === undefined) request?.resolve();
      else request?.reject(new Error(error));
    },
    close: () => {
      closed = true;
      for (const { reject } of waiting.values()) reject(ended());
      waiting.clear();
    },
  };
};

/** Where a line ends in `buffer` from `start`, or -1. */
const newline = (buffer: Buffer, start: number): number =>
  buffer.indexOf(10, start);

/**
 * Splits `stream` into lines of at most `max` bytes, without holding more: a
 * longer one yields `over` and ends the reading, never half a frame.
 */
export const boundedLines = async function* (
  stream: Readable,
  max: number,
): AsyncGenerator<string | { over: true }> {
  let parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    let start = 0;
    for (let at = newline(buffer, 0); at !== -1; at = newline(buffer, start)) {
      size += at - start;
      if (size > max) break;
      parts.push(buffer.subarray(start, at));
      yield Buffer.concat(parts).toString("utf8");
      parts = [];
      size = 0;
      start = at + 1;
    }
    if (size <= max) {
      parts.push(buffer.subarray(start));
      size += buffer.length - start;
    }
    if (size > max) {
      yield { over: true };
      return;
    }
  }
  if (size > 0) yield Buffer.concat(parts).toString("utf8");
};

const isFrame = (value: unknown): value is Frame =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One line as a frame; `undefined` when it is not a JSON object. */
export const parsed = (line: string): Frame | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    return isFrame(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** The codec's reading of `frame`; one it throws on fails the leg, never allows. */
export const decodeSafely = (codec: Codec, frame: Frame): DecodedFrame => {
  try {
    return codec.decode(frame);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { events: [], fail: `could not read a frame: ${why}` };
  }
};
