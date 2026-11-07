/**
 * @file `ork ui`'s process model (ADR-060): the command in the terminal only
 *   supervises; its server runs in a child, the launcher the user ran
 *   (`process.argv[1]` as given, so after an upgrade it is the new install's)
 *   with `ui --serve`. The port and the token go over the child's IPC channel.
 *   When the page asks for a restart, the child says so and exits, and the
 *   supervisor starts the launcher again on the same port with the same token,
 *   so the open tab stays signed in. There is only ever one child; Ctrl-C (or
 *   SIGTERM) stops it and then the supervisor, which exits with its code. The
 *   child may wait for an upgrade to finish first; a second Ctrl-C (or SIGTERM)
 *   kills it and exits at once.
 */

import { spawn } from "node:child_process";
import { constants } from "node:os";

import { childMessage, type StartMessage } from "./ui-protocol.ts";

/** The supervisor's handle on one child. */
export type ServerChild = {
  send: (message: StartMessage) => void;
  kill: (signal: NodeJS.Signals) => void;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number | null) => void) => void;
  /** Its IPC channel closed: every message it sent has come. */
  onDisconnect: (listener: () => void) => void;
};

export type Ready = { port: number; version: string; restarted: boolean };

export type SuperviseOptions = {
  port: number;
  token: string;
  /** Starts the server's process, which then asks for its port and token. */
  spawnServer: () => ServerChild;
  /** The child serves: the first time, or after a restart. */
  onReady: (ready: Ready) => void | Promise<void>;
  /** Calls back on each Ctrl-C or SIGTERM, with the signal. */
  onStop: (stop: (signal: NodeJS.Signals) => void) => void;
  say: (line: string) => void;
  sayErr: (line: string) => void;
};

/**
 * How long an exited child's channel may take to close before the supervisor
 * decides without it; a child's channel closes with it, so this is only a
 * backstop.
 */
export const CHANNEL_CLOSE_MS = 2000;

/** A shell's exit code for a process a signal stopped. */
const signalled = (signal: NodeJS.Signals): number =>
  128 + constants.signals[signal];

/** Supervises the server until it stops; resolves the exit code. */
export const supervise = (options: SuperviseOptions): Promise<number> =>
  new Promise(resolve => {
    const { token, say, sayErr } = options;
    let port = options.port;
    let stopping = false;
    let ended = false;
    let restarts = 0;
    let current: ServerChild | null = null;

    const end = (code: number): void => {
      if (ended) return;
      ended = true;
      resolve(code);
    };

    const start = (): void => {
      let restarting = false;
      let ready = false;
      let exited: { code: number | null } | null = null;
      let disconnected = false;
      let backstop: ReturnType<typeof setTimeout> | undefined;
      const child = options.spawnServer();
      current = child;

      const decide = (): void => {
        clearTimeout(backstop);
        if (exited === null || ended || current !== child) return;
        const { code } = exited;
        if (restarting && !stopping) {
          restarts += 1;
          say("Restarting Ork's UI from the installed `ork`…");
          start();
          return;
        }
        if (!ready && restarts > 0) {
          sayErr(
            `Ork's UI did not start again (exit ${String(code)}). Start it with: ork ui --port ${String(port)}`,
          );
        } else if (ready && code !== 0 && !stopping) {
          sayErr(`Ork's UI stopped: its server exited with ${String(code)}.`);
        }
        if (ready) say("Ork's UI stopped.");
        end(code ?? (stopping ? 0 : 1));
      };

      child.onMessage(raw => {
        const message = childMessage(raw);
        if (message?.type === "ork-ui-hello") {
          child.send({ type: "ork-ui-start", port, token });
        } else if (message?.type === "ork-ui-ready") {
          ready = true;
          ({ port } = message);
          void options.onReady({
            port,
            version: message.version,
            restarted: restarts > 0,
          });
        } else if (message?.type === "ork-ui-failed") {
          sayErr(message.error);
        } else if (message?.type === "ork-ui-restart") {
          restarting = true;
        }
      });
      // A restart's message can come after the exit; the decision waits for
      // the channel to close, so it has every message.
      child.onExit(code => {
        exited = { code };
        if (disconnected) decide();
        else backstop = setTimeout(decide, CHANNEL_CLOSE_MS);
      });
      child.onDisconnect(() => {
        disconnected = true;
        decide();
      });
    };

    options.onStop(signal => {
      if (!stopping) {
        stopping = true;
        current?.kill(signal);
        return;
      }
      // A second one: stop now, without waiting for the child.
      current?.kill("SIGKILL");
      say("Ork's UI stopped.");
      end(signalled(signal));
    });
    start();
  });

/**
 * Starts `launcher ui --serve` with the same Node, on this terminal, with an
 * IPC channel for the port and the token.
 */
export const spawnServerFrom = (launcher: string) => (): ServerChild => {
  const child = spawn(
    process.execPath,
    [...process.execArgv, launcher, "ui", "--serve"],
    { stdio: ["inherit", "inherit", "inherit", "ipc"] },
  );
  return {
    send: message => {
      if (child.connected) child.send(message);
    },
    kill: signal => {
      child.kill(signal);
    },
    onMessage: listener => {
      child.on("message", listener);
    },
    onExit: listener => {
      let told = false;
      const once = (code: number | null): void => {
        if (told) return;
        told = true;
        listener(code);
      };
      // A launcher that can't start ends here, with no `exit`; a failed
      // kill or send comes here too, but the child's `exit` still follows.
      child.on("error", () => {
        if (child.pid === undefined) once(1);
      });
      child.on("exit", once);
    },
    onDisconnect: listener => {
      let told = false;
      const once = (): void => {
        if (told) return;
        told = true;
        listener();
      };
      // A launcher that can't start never had a channel to close.
      child.on("error", () => {
        if (child.pid === undefined) once();
      });
      child.on("disconnect", once);
    },
  };
};

/** Ctrl-C and SIGTERM, for {@link SuperviseOptions.onStop}. */
export const onStopSignals = (stop: (signal: NodeJS.Signals) => void): void => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stop(signal);
    });
  }
};
