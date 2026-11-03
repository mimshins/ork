/**
 * @file A one-off read of the server, held in a container: the few things no
 *   stream sends, such as the projects and a project's workflows. When reads
 *   overlap the newest wins, so a slow answer about the last project chosen
 *   cannot replace the answer about this one.
 */

import type { CallResult } from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

export type ReadState<T, A> =
  | { status: "idle" }
  /** `previous` is what was there, which can stay on the page meanwhile. */
  | { status: "loading"; arg: A; previous?: T }
  | { status: "ready"; arg: A; data: T }
  | { status: "failed"; arg: A; error: string };

export type Read<T, A> = {
  state: Container<ReadState<T, A>>;
  load: (arg: A) => Promise<void>;
};

export const createRead = <T, A = void>(
  fetchIt: (arg: A) => Promise<CallResult<T>>,
): Read<T, A> => {
  const state = Container.create<ReadState<T, A>>({ status: "idle" });
  let newest = 0;
  return {
    state,
    load: async arg => {
      newest += 1;
      const mine = newest;
      const before = state.getValue();
      const previous =
        before.status === "ready"
          ? before.data
          : before.status === "loading"
            ? before.previous
            : undefined;
      void state.setValue(
        previous === undefined
          ? { status: "loading", arg }
          : { status: "loading", arg, previous },
      );
      const answer = await fetchIt(arg);
      if (mine !== newest) return;
      void state.setValue(
        answer.ok
          ? { status: "ready", arg, data: answer.data }
          : { status: "failed", arg, error: answer.error },
      );
    },
  };
};
