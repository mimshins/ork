/**
 * @file The server's side of `ork ui` (ADR-060): `ork ui --serve`, which only
 *   `ork ui` starts. It says hello over its IPC channel, takes the port and the
 *   token from the supervisor, serves, and says it's ready. A restart asked by
 *   the page tells the supervisor, then closes and exits, so the supervisor
 *   starts the installed `ork` in its place. Ctrl-C, SIGTERM, or losing the
 *   supervisor closes it too, so no server is left behind; an upgrade still
 *   running is waited for first.
 */

import { constants } from "node:os";

import { scrubberOfRun } from "@krapht/ork-nodes";
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

const ignore = (): void => {};

/** What the terminal says while an upgrade holds the stop up. */
export const WAITING_FOR_UPGRADE =
  "Waiting for the upgrade to finish… Press Ctrl-C again to stop now.";

/**
 * Ends on Ctrl-C, SIGTERM, the supervisor's channel closing, or `end`. Each
 * Ctrl-C reaches the child twice (from the terminal, and passed on by the
 * supervisor), so while the supervisor is there, forcing a stop is its job: it
 * kills the child on the second. Without it, a signal after the first stop
 * exits at once.
 */
const stopper = () => {
  let end: () => void = ignore;
  let stopped = false;
  const promise = new Promise<void>(resolve => {
    end = () => {
      stopped = true;
      resolve();
    };
  });
  const onSignal = (signal: NodeJS.Signals): void => {
    if (stopped && !process.connected) {
      process.exit(128 + constants.signals[signal]);
    }
    end();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.once("disconnect", () => {
    end();
  });
  return {
    promise,
    end: () => {
      end();
    },
  };
};

/**
 * Waits for an upgrade still running before the server closes, saying so on the
 * terminal: exiting mid-install could leave `ork` half-installed. The
 * installer's output is read to its end meanwhile.
 */
export const upgradeFinished = async (
  server: Pick<RunningServer, "upgrading">,
  say: (line: string) => void,
): Promise<void> => {
  const running = server.upgrading();
  if (running === null) return;
  say(WAITING_FOR_UPGRADE);
  await running.catch(ignore);
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
      // An older supervisor sends none; the server then makes its own.
      ...(start.session === undefined ? {} : { sessionSecret: start.session }),
      ui: uiFolders(),
      update: { name: ORK_NAME },
      restart: () => {
        void send({ type: "ork-ui-restart" }).then(end);
      },
      noteScrub: (run, registered) => scrubberOfRun(run, registered),
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
    await upgradeFinished(server, writeErr);
    await server.close();
  }
  // A check still asking the registry must not hold the restart up.
  process.exit(server === null ? 1 : 0);
};
