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
  | { status: "loading"; arg: A }
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
      void state.setValue({ status: "loading", arg });
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
