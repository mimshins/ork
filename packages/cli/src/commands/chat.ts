/**
 * @file `ork chat <run> <node>`: talk to one node. A node of a live run gets
 *   each message at its session's next step, and its replies stream here; a
 *   node of a finished run is answered by resuming its last session.
 */

import { createInterface } from "node:readline/promises";

import {
  type EventStore,
  liveStatus,
  openStore,
  type RunRecord,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write } from "../output.ts";
import { nodeSession, resumeChat, tellLiveRun } from "../runs/chat.ts";
import { findRun } from "../runs/find.ts";
import { followRun } from "../runs/logs.ts";
import { isDriver, loadRuntime } from "./run.ts";

const writeErr = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

/** Asks for one line; `null` once the input ends (Ctrl-D). */
const askLine = async (): Promise<string | null> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise<null>(resolve => {
    rl.once("close", () => {
      resolve(null);
    });
  });
  try {
    const line = await Promise.race([
      rl.question(style("bold", "you › ")),
      closed,
    ]);
    return line;
  } finally {
    rl.close();
  }
};

/** Chats with a node of a live run until the input ends or the run does. */
const chatLive = async (
  store: EventStore,
  run: RunRecord,
  node: string,
  message: string | undefined,
): Promise<void> => {
  if (message !== undefined) {
    const woke = await tellLiveRun(store, run, node, message);
    write(
      `Sent to ${node}${woke ? "" : " (the run will see it within a second)"}; follow its replies with ork logs ${run.id} -f --node ${node}.`,
    );
    return;
  }
  write(
    style("dim", `Chatting with ${node} in live run ${run.id}; Ctrl-D leaves.`),
  );
  const abort = new AbortController();
  const after = store.events(run.id, 0).at(-1)?.seq ?? 0;
  const following = followRun(store, run, write, {
    follow: true,
    json: false,
    node,
    after,
    signal: abort.signal,
  }).finally(() => {
    abort.abort();
  });
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- one message at a time
    const line = await Promise.race([askLine(), following.then(() => null)]);
    if (line === null || abort.signal.aborted) break;
    // oxlint-disable-next-line no-await-in-loop -- sent before the next prompt
    if (line.trim() !== "") await tellLiveRun(store, run, node, line);
  }
  abort.abort();
  await following;
  write(
    style(
      "dim",
      "The chat ended; ork chat again resumes the node's session once the run is over.",
    ),
  );
};

export const chat = defineCommand({
  meta: {
    name: "chat",
    description: "Talk to a node of a run: live, or by resuming its session",
  },
  args: {
    run: {
      type: "positional",
      description: "A run id or a prefix of one",
      required: true,
    },
    node: {
      type: "positional",
      description: "The node to talk to",
      required: true,
    },
    message: {
      type: "string",
      alias: "m",
      description: "Send this one message instead of chatting",
    },
    driver: {
      type: "string",
      description:
        "For a finished run: sdk or cli (default: the one it ran with)",
    },
  },
  run: async ({ args }) => {
    const store = openStore();
    try {
      const found = findRun(store, args.run, process.cwd());
      if (!found.ok) {
        writeErr(found.error);
        process.exitCode = 1;
        return;
      }
      const { run } = found;
      const { session } = nodeSession(store.events(run.id, 0), args.node);
      if (!session.known || !session.chattable) {
        writeErr(
          session.known
            ? `${args.node} is not a leader or worker; only they have sessions to talk to.`
            : `${args.node} is not a node of run ${run.id}.`,
        );
        process.exitCode = 1;
        return;
      }
      if (args.driver !== undefined && !isDriver(args.driver)) {
        writeErr(`--driver must be sdk or cli, not "${args.driver}".`);
        process.exitCode = 1;
        return;
      }
      if (liveStatus(run) === "running") {
        await chatLive(store, run, args.node, args.message);
        return;
      }
      const human = createTerminalHuman({
        input: process.stdin,
        output: process.stdout,
        interactive: process.stdin.isTTY,
      });
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- one turn at a time
        const body = args.message ?? (await askLine());
        if (body === null) return;
        if (body.trim() === "") continue;
        // oxlint-disable-next-line no-await-in-loop -- one turn at a time
        const problem = await resumeChat({
          store,
          run,
          node: args.node,
          body,
          runtime: loadRuntime,
          human,
          out: write,
          ...(args.driver === undefined ? {} : { driver: args.driver }),
        });
        if (problem !== null) {
          writeErr(problem);
          process.exitCode = 1;
          return;
        }
        if (args.message !== undefined) return;
      }
    } finally {
      store.close();
    }
  },
});
