/**
 * @file A live run's control: the decision queue, the watcher that picks up
 *   answers, commands and chat messages other processes wrote to the store, and
 *   the run's socket, which wakes the watcher at once and streams events to
 *   followers. Without the socket (it failed to listen) the watcher still
 *   polls.
 */

import type { RunEvent } from "../run/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import type {
  DecisionRecord,
  EventStore,
  StoredEvent,
} from "../store/types.ts";
import { createDecisionQueue } from "./queue.ts";
import { type RunSocket, serveRun, socketPath } from "./socket.ts";

export type ControlOptions = {
  store: EventStore;
  runId: string;
  /** The run's own terminal; none for a detached run. */
  local?: HumanChannel;
  /** Records an event (the run's recorder). */
  emit: (event: RunEvent) => void;
  /** `ork stop` arrived. */
  onStop: () => void;
  /** `ork chat` sent `node` a message. */
  onMessage: (node: string, body: string) => void;
  /** `~`, for the socket's folder; tests pass one. */
  home?: string;
  /** How often to look at the store without a wake-up (default 1 s). */
  intervalMs?: number;
};

export type RunControl = {
  /** The run's `HumanChannel`: questions become decisions. */
  human: HumanChannel;
  /** Streams a stored event to the socket's followers. */
  publish: (stored: StoredEvent) => void;
  /** Looks at the store now. */
  check: () => void;
  close: () => Promise<void>;
};

export const startControl = async (
  options: ControlOptions,
): Promise<RunControl> => {
  const { store, runId } = options;
  const waiting = new Map<string, (closed: DecisionRecord) => void>();
  let stopped = false;

  const check = (): void => {
    for (const [id, resolve] of waiting) {
      const decision = store.decision(id);
      if (decision !== undefined && decision.status !== "open") {
        waiting.delete(id);
        resolve(decision);
      }
    }
    for (const command of store.takeCommands(runId)) {
      if (command.kind === "message") {
        options.onMessage(command.node, command.body);
      } else if (!stopped) {
        stopped = true;
        options.emit({ type: "run.command", command: "stop" });
        options.onStop();
      }
    }
  };

  // Keeps the process alive while the run waits on a decision; `close` ends it.
  const timer = setInterval(check, options.intervalMs ?? 1000);

  let socket: RunSocket | undefined;
  try {
    socket = await serveRun({
      path: socketPath(runId, options.home),
      onWake: check,
      backlog: after => store.events(runId, after),
    });
  } catch {
    // No socket (e.g. the path is too long): the watcher still polls.
  }

  const human = createDecisionQueue({
    store,
    runId,
    emit: options.emit,
    waitFor: (id, signal) => {
      const { promise, resolve, reject } =
        Promise.withResolvers<DecisionRecord>();
      waiting.set(id, resolve);
      signal.addEventListener(
        "abort",
        () => {
          waiting.delete(id);
          reject(new Error("settled"));
        },
        { once: true },
      );
      check();
      return promise;
    },
    ...(options.local === undefined ? {} : { local: options.local }),
  });

  return {
    human,
    publish: stored => {
      socket?.publish(stored);
    },
    check,
    close: async () => {
      clearInterval(timer);
      await socket?.close();
    },
  };
};
