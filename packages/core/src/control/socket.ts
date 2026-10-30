/**
 * @file The per-run local socket (`~/.ork/sockets/<run>.sock`): the fast path
 *   beside the store (ADR-024). Other `ork` processes `wake` a run when they
 *   have written an answer or a command, and `follow` a run to get each event
 *   as it is stored. One JSON message per line; nothing is lost when the socket
 *   is gone, since the store has it all.
 */

import { mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import type { StoredEvent } from "../store/types.ts";

/** Where a run's socket lives; `home` is `~` (tests pass a folder). */
export const socketPath = (runId: string, home: string = homedir()): string =>
  path.join(home, ".ork", "sockets", `${runId}.sock`);

/** For errors another handler already settles. */
const ignore = (): void => {
  // Handled by the socket's own `error` listener.
};

export type SocketMessage =
  | { type: "wake" }
  /** Sends every event stored after `after`, then each new one. */
  | { type: "follow"; after: number };

const messageOf = (line: string): SocketMessage | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || !("type" in value)) {
      return undefined;
    }
    if (value.type === "wake") return { type: "wake" };
    if (value.type === "follow") {
      const after = "after" in value ? Number(value.after) : 0;
      return { type: "follow", after: Number.isFinite(after) ? after : 0 };
    }
  } catch {
    // Not JSON: ignored.
  }
  return undefined;
};

export type RunSocket = {
  /** Sends a stored event to every follower. */
  publish: (stored: StoredEvent) => void;
  /** Ends the followers, closes the socket and removes its file. */
  close: () => Promise<void>;
};

export type ServeOptions = {
  path: string;
  onWake: () => void;
  /** The events stored after `seq`, for a follower that joins late. */
  backlog: (after: number) => StoredEvent[];
};

/** Listens on the run's socket; resolves once it is listening. */
export const serveRun = async (options: ServeOptions): Promise<RunSocket> => {
  mkdirSync(path.dirname(options.path), { recursive: true });
  // A socket file left by a crashed run with the same id.
  rmSync(options.path, { force: true });
  const followers = new Set<Socket>();
  const server = createServer(socket => {
    socket.on("error", () => {
      followers.delete(socket);
    });
    socket.on("close", () => {
      followers.delete(socket);
    });
    const lines = createInterface({ input: socket });
    lines.on("error", ignore);
    lines.on("line", line => {
      const message = messageOf(line);
      if (message?.type === "wake") options.onWake();
      if (message?.type === "follow") {
        for (const stored of options.backlog(message.after)) {
          socket.write(`${JSON.stringify(stored)}\n`);
        }
        followers.add(socket);
      }
    });
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once("error", reject);
  server.listen(options.path, () => {
    resolve();
  });
  await promise;

  return {
    publish: stored => {
      const line = `${JSON.stringify(stored)}\n`;
      for (const socket of followers) socket.write(line);
    },
    close: () => {
      for (const socket of followers) socket.end();
      const closed = Promise.withResolvers<void>();
      server.close(() => {
        closed.resolve();
      });
      rmSync(options.path, { force: true });
      return closed.promise;
    },
  };
};

/** Tells a live run to look at the store now; false when it is not listening. */
export const wakeRun = (file: string): Promise<boolean> => {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = createConnection(file, () => {
    socket.end(`${JSON.stringify({ type: "wake" })}\n`, () => {
      resolve(true);
    });
  });
  socket.on("error", () => {
    resolve(false);
  });
  return promise;
};

/**
 * Follows a live run over its socket: `onEvent` gets each event stored after
 * `after`. Resolves `"ended"` when the run closes the socket, or
 * `"unavailable"` when no run is listening.
 */
export const followSocket = (
  file: string,
  after: number,
  onEvent: (stored: StoredEvent) => void,
  signal?: AbortSignal,
): Promise<"ended" | "unavailable"> => {
  const { promise, resolve } = Promise.withResolvers<"ended" | "unavailable">();
  let connected = false;
  const socket = createConnection(file, () => {
    connected = true;
    socket.write(`${JSON.stringify({ type: "follow", after })}\n`);
  });
  const lines = createInterface({ input: socket });
  // The socket's own error handler below settles; readline re-emits it.
  lines.on("error", ignore);
  lines.on("line", line => {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the run writes StoredEvent lines from its store
      onEvent(JSON.parse(line) as StoredEvent);
    } catch {
      // A partial line from a closing socket: the store has it.
    }
  });
  socket.on("error", () => {
    resolve(connected ? "ended" : "unavailable");
  });
  socket.on("close", () => {
    resolve(connected ? "ended" : "unavailable");
  });
  signal?.addEventListener("abort", () => {
    socket.destroy();
  });
  return promise;
};
