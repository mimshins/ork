/**
 * @file What a workflow run's control does with what other processes ask of it:
 *   stop it, and hand on the user's and linked nodes' messages. Each waits for
 *   the run to have started, as a command may arrive before it has.
 */

import type { RunHandle } from "@krapht/ork-core";

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
    onNotice: (node: string, text: string) => {
      when(run => {
        run.notice(node, text);
      });
    },
  };
};
