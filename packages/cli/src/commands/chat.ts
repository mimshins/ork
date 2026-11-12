/**
 * @file `ork chat <run> <node>`: talk to one node. A node of a live run gets
 *   each message at its session's next step, and its replies stream here; a
 *   node of a finished run is answered by resuming its last session.
 */

import {
  type EventStore,
  findRun,
  liveStatus,
  nodeSession,
  openStore,
  type RunRecord,
  tellLiveRun,
} from "@krapht/ork-core";
import { DRIVER_IDS } from "@krapht/ork-integrations";
import { defineCommand } from "citty";

import { createTerminalHuman } from "../human.ts";
import { style, write, writeErr } from "../output.ts";
import { resumeChat } from "../runs/chat.ts";
import { followRun } from "../runs/logs.ts";
import { readText } from "../term/text.ts";
import { chatRefusal } from "./in-a-run.ts";
import { badDriver, isDriver, loadRuntime } from "./run.ts";

/**
 * Asks for one line; `null` once the input ends (Ctrl-D), Esc leaves, or
 * `signal` withdraws it. A live chat prints replies while it waits, which a
 * redrawn prompt can't share the screen with, so it asks line by line.
 */
const askLine = async (
  live = false,
  signal?: AbortSignal,
): Promise<string | null> => {
  const asked = await readText(
    {
      input: process.stdin,
      output: process.stdout,
      ...(live ? { env: { ...process.env, ORK_PLAIN: "1" } } : {}),
    },
    {
      message: "you",
      // The line stays as `you › text` above the reply.
      done: value => ` you › ${value ?? ""}`,
      ...(signal === undefined ? {} : { signal }),
    },
  ).catch(() => ({ kind: "cancelled" as const }));
  return asked.kind === "text" ? asked.value : null;
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
    const line = await Promise.race([
      askLine(true, abort.signal),
      following.then(() => null),
    ]);
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
      description: `For a finished run: ${DRIVER_IDS.join(", ")} (default: the one it ran with)`,
    },
  },
  run: async ({ args }) => {
    // A program or an agent in a run must not speak as the user (RFC-003).
    const refusal = chatRefusal();
    if (refusal !== null) {
      writeErr(refusal);
      process.exitCode = 1;
      return;
    }
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
        writeErr(`${badDriver(args.driver)}.`);
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
