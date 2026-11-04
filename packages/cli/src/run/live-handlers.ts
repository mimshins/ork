/**
 * @file What a workflow run's control does with what other processes ask of it:
 *   stop it, and hand on the user's and linked nodes' messages. Each waits for
 *   the run to have started, as a command may arrive before it has.
 */

import type { RunControl, RunHandle } from "@krapht/ork-core";

/**
 * Takes what is on its way before the run ends: with no socket, a program's
 * message may not have been seen yet. Each command waits on `started`, so
 * waiting on it too lets them all land first.
 */
export const takeLastCommands =
  (control: Pick<RunControl, "check">, started: Promise<unknown>) =>
  async (): Promise<void> => {
    control.check();
    await started;
  };

/** `ork pause`, `ork continue` and `ork stop --node`, on the run as it is. */
export const liveControl =
  (live: { handle?: RunHandle }) =>
  (
    command: "pause" | "continue" | "stop",
    node: string | undefined,
  ): boolean => {
    const { handle } = live;
    if (handle === undefined) return false;
    if (command === "pause") return handle.pause(node);
    if (command === "continue") return handle.proceed(node);
    return node !== undefined && handle.stopNode(node);
  };

export const liveHandlers = (started: Promise<RunHandle>) => {
  const when = (act: (run: RunHandle) => void): void => {
    void started.then(act);
  };
  return {
    onStop: () => {
      when(run => {
        run.interrupt();
      });
    },
    onMessage: (node: string, body: string) => {
      when(run => {
        run.tell(node, body);
      });
    },
    onRelay: (node: string, from: string, body: string) => {
      when(run => {
        run.receive(node, from, body);
      });
    },
    onScript: (node: string, from: string, body: string) => {
      when(run => {
        run.receive(node, from, body, "script");
      });
    },
    onNotice: (node: string, text: string) => {
      when(run => {
        run.notice(node, text);
      });
    },
  };
};
