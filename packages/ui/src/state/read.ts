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
  /** `shown` is what was there, which can stay on the page meanwhile. */
  | { status: "loading"; arg: A; shown?: Shown<T, A> }
  | { status: "ready"; arg: A; data: T }
  | { status: "failed"; arg: A; error: string; shown?: Shown<T, A> };

/** An answer, with what it answered. */
export type Shown<T, A> = { data: T; arg: A };

/** The last answer a read has, whatever it is doing now. */
export const shownOf = <T, A>(
  read: ReadState<T, A>,
): Shown<T, A> | undefined =>
  read.status === "ready"
    ? { data: read.data, arg: read.arg }
    : read.status === "idle"
      ? undefined
      : read.shown;

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
      const shown = shownOf(state.getValue());
      void state.setValue({
        status: "loading",
        arg,
        ...(shown === undefined ? {} : { shown }),
      });
      const answer = await fetchIt(arg);
      if (mine !== newest) return;
      void state.setValue(
        answer.ok
          ? { status: "ready", arg, data: answer.data }
          : {
              status: "failed",
              arg,
              error: answer.error,
              ...(shown === undefined ? {} : { shown }),
            },
      );
    },
  };
};
