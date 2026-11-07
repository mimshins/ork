/**
 * @file The server's side of `ork ui` (ADR-060): `ork ui --serve`, which only
 *   `ork ui` starts. It says hello over its IPC channel, takes the port and the
 *   token from the supervisor, serves, and says it's ready. A restart asked by
 *   the page tells the supervisor, then closes and exits, so the supervisor
 *   starts the installed `ork` in its place. Ctrl-C, SIGTERM, or losing the
 *   supervisor closes it too, so no server is left behind.
 */

import { type RunningServer, startServer } from "@krapht/ork-server";

import { ORK_NAME, ORK_VERSION } from "../__build_info__.ts";
import { writeErr } from "../output.ts";
import { uiFolders } from "./folder.ts";
import {
  type ChildMessage,
  type StartMessage,
  startMessage,
} from "./ui-protocol.ts";

const NOT_SUPERVISED =
  "`ork ui --serve` is how `ork ui` starts its server; run `ork ui`.";

/** Sends a message; resolves once it has gone, so an exit can't drop it. */
type Send = (message: ChildMessage) => Promise<void>;

const send: Send = message =>
  new Promise(resolve => {
    if (!process.connected || process.send === undefined) {
      resolve();
      return;
    }
    process.send(message, undefined, {}, () => {
      resolve();
    });
  });

/** The supervisor's `start`, after saying hello. */
const started = (): Promise<StartMessage> =>
  new Promise(resolve => {
    const listen = (raw: unknown): void => {
      const message = startMessage(raw);
      if (message === null) return;
      process.off("message", listen);
      resolve(message);
    };
    process.on("message", listen);
    void send({ type: "ork-ui-hello" });
  });

/** Ends on Ctrl-C, SIGTERM, the supervisor's channel closing, or `end`. */
const ignore = (): void => {};

const stopper = () => {
  let end: () => void = ignore;
  const promise = new Promise<void>(resolve => {
    end = resolve;
  });
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  process.once("disconnect", end);
  return { promise, end };
};

const serve = async (
  start: StartMessage,
  end: () => void,
): Promise<RunningServer | null> => {
  try {
    return await startServer({
      version: ORK_VERSION,
      port: start.port,
      token: start.token,
      ui: uiFolders(),
      update: { name: ORK_NAME },
      restart: () => {
        void send({ type: "ork-ui-restart" }).then(end);
      },
    });
  } catch (error) {
    await send({
      type: "ork-ui-failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

/** `ork ui --serve`: serves until stopped; exits when it closes. */
export const serveForSupervisor = async (): Promise<void> => {
  if (process.send === undefined) {
    writeErr(NOT_SUPERVISED);
    process.exitCode = 1;
    return;
  }
  const stop = stopper();
  const start = await Promise.race([started(), stop.promise.then(() => null)]);
  const server = start === null ? null : await serve(start, stop.end);
  if (server !== null) {
    await send({
      type: "ork-ui-ready",
      port: server.port,
      version: ORK_VERSION,
    });
    await stop.promise;
    await server.close();
  }
  // A check still asking the registry must not hold the restart up.
  process.exit(server === null ? 1 : 0);
};
