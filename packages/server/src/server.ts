/**
 * @file Starts the local server (ADR-039, specs/server.md): `node:http` on
 *   loopback only, every request through the guards, then the event streams,
 *   the JSON routes, and the page. It opens the store as one more client and
 *   runs nothing itself; it records itself in `~/.ork/ui.json` while it runs.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { openStore, storePath } from "@krapht/ork-core";

import { hasUi } from "./assets.ts";
import type { ServerContext } from "./context.ts";
import { createDispatch } from "./dispatch.ts";
import { newToken } from "./guards.ts";
import { sendError } from "./http.ts";
import { removeUiFile, uiFilePath, writeUiFile } from "./ui-file.ts";
import { createUpdates, type UpdateOptions } from "./updates.ts";

/** The port `ork ui` serves on unless told otherwise. */
export const DEFAULT_PORT = 4417;

export type ServerOptions = {
  /** Ork's version, for `/api/health`. */
  version: string;
  /** Default 4417; 0 picks a free port (tests). */
  port?: number;
  /** `~`: the store, the sockets and `ui.json` (tests pass a folder). */
  home?: string;
  /** The `ork` script detached runs start (default: the running one). */
  script?: string;
  /** Write `~/.ork/ui.json` (default true). */
  record?: boolean;
  /** Where the server reports a request that failed (default: stderr). */
  log?: (line: string) => void;
  /**
   * Folders that may hold the built UI (`index.html` and `assets/`); the first
   * that does is served, and the placeholder page when none does.
   */
  ui?: readonly string[];
  /**
   * Runs `gh` for publishing feedback (default: the real one); tests pass their
   * own.
   */
  gh?: ServerContext["gh"];
  /**
   * The sign-in token (default: a new one). `ork ui` hands the same one to the
   * server it restarts, so the open tab stays signed in.
   */
  token?: string;
  /**
   * The new-version check and the upgrade; without it the server reports the
   * check off and offers no upgrade.
   */
  update?: UpdateOptions;
  /** Restarts `ork ui` onto the installed `ork`; only `ork ui` knows how. */
  restart?: () => void;
};

export type RunningServer = {
  port: number;
  /** `http://127.0.0.1:<port>`. */
  url: string;
  token: string;
  /** Stops the streams and the server, and removes `ui.json`. */
  close: () => Promise<void>;
};

const listen = (
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${String(port)} is in use; start Ork's UI on another with \`--port <n>\`.`,
            )
          : error,
      );
    });
    server.listen(port, "127.0.0.1", () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a TCP server's address is AddressInfo
      resolve((server.address() as AddressInfo).port);
    });
  });

export const startServer = async (
  options: ServerOptions,
): Promise<RunningServer> => {
  const store = openStore(storePath(options.home));
  const startedAt = new Date().toISOString();
  const uiDir = options.ui?.find(dir => hasUi(dir));
  const updates = createUpdates({
    version: options.version,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.update === undefined ? {} : { options: options.update }),
  });
  const context: ServerContext = {
    store,
    version: options.version,
    pid: process.pid,
    startedAt,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.script === undefined ? {} : { script: options.script }),
    ...(uiDir === undefined ? {} : { uiDir }),
    ...(options.gh === undefined ? {} : { gh: options.gh }),
    updates,
    ...(options.restart === undefined ? {} : { restart: options.restart }),
  };
  const token = options.token ?? newToken();
  const shutdown = new AbortController();
  const log =
    options.log ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });
  let port = options.port ?? DEFAULT_PORT;

  const handle = createDispatch(context, {
    port: () => port,
    token,
    shutdown: shutdown.signal,
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(
        `ork ui: ${req.method ?? ""} ${req.url?.split("?")[0] ?? ""} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (res.headersSent) res.destroy();
      else sendError(res, 500, "The server failed; see its terminal.");
    });
  });
  try {
    port = await listen(server, port);
  } catch (error) {
    updates.close();
    store.close();
    throw error;
  }
  const file = uiFilePath(options.home);
  if (options.record !== false) {
    writeUiFile(file, { port, pid: process.pid, token, startedAt });
  }
  let closed: Promise<void> | undefined;
  return {
    port,
    url: `http://127.0.0.1:${String(port)}`,
    token,
    close: () => {
      closed ??= new Promise<void>(resolve => {
        shutdown.abort();
        updates.close();
        server.close(() => {
          store.close();
          if (options.record !== false) removeUiFile(file, process.pid);
          resolve();
        });
        server.closeAllConnections();
      });
      return closed;
    },
  };
};
