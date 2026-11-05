/**
 * @file `ork send` (RFC-005): a program in a tool node writes to a session on
 *   its run's bus. The check is on the sender's side, as a refusal must be an
 *   exit code a script can act on; then a row in the store and a wake, as for a
 *   message between linked runs. `ORK_RUN` and `ORK_NODE` say who it is, and
 *   they are attribution, not proof: the check stops mistakes, not a program
 *   running as the same user.
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import { MESSAGE_LIMIT } from "../run/bus-text.ts";
import { scriptContactsOf } from "../run/contacts.ts";
import type { EventStore } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { DEFAULT_LINK_MESSAGES } from "./links.ts";

/** A first value, as for links; real use will show whether it is the right one. */
export const DEFAULT_SCRIPT_MESSAGES = DEFAULT_LINK_MESSAGES;

export type ScriptSender = {
  run: string | undefined;
  node: string | undefined;
  to: string;
};

export type ScriptSend = ScriptSender & { body: string };

/**
 * Why this sender may not write to this node; `null` when it may. The body is
 * not needed, so a program is told before it pipes a whole message in.
 */
export const scriptRefusal = (
  store: EventStore,
  send: ScriptSender,
): string | null => {
  const { run: runId, node, to } = send;
  if (runId === undefined || node === undefined) {
    return "`ork send` runs inside a tool node of a run: `ORK_RUN` and `ORK_NODE` are not set.";
  }
  // It has no message bus to take a message.
  if (runId.startsWith("node-")) {
    return `Run ${runId} runs one node, which has no message bus; run the whole workflow.`;
  }
  const run = store.lookup(runId).find(found => found.id === runId);
  if (run === undefined) return `There is no run ${runId}.`;
  const status = liveStatus(run);
  if (status !== "running") return `Run ${runId} is not running (${status}).`;
  // The latest: a resumed run may have changed its channels.
  const started = store
    .events(runId)
    .map(stored => stored.event)
    .findLast(event => event.type === "run.started");
  if (started === undefined) return `Run ${runId} has not started yet.`;
  const own = started.nodes.find(found => found.id === node);
  if (own === undefined || !own.type.startsWith("tool.")) {
    return `${node} is not a tool node of run ${runId}.`;
  }
  const contacts = scriptContactsOf(
    node,
    started.nodes,
    started.channels ?? [],
  );
  if (contacts.includes(to)) return null;
  return contacts.length === 0
    ? `\`${node}\` has no one to write to: give it an owner, or a channel under \`messages:\`.`
    : `\`${to}\` is not a contact of \`${node}\`, which can write to \`${contacts.join("`, `")}\` (its owner and its channels).`;
};

/** Reading all of it would cost as much as sending it. */
export const TOO_LONG =
  "The message is over 64 KiB. Write it to a file and send the file's path.";

/** Checks the message, writes it for the run, and wakes it. */
export const sendFromScript = async (
  store: EventStore,
  send: ScriptSend,
  home?: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const refused = scriptRefusal(store, send);
  if (refused !== null) return { ok: false, error: refused };
  if (Buffer.byteLength(send.body) > MESSAGE_LIMIT) {
    return { ok: false, error: TOO_LONG };
  }
  const run = String(send.run);
  const node = String(send.node);
  const taken = store.scriptCommand(
    run,
    { kind: "script", node: send.to, from: node, body: send.body },
    DEFAULT_SCRIPT_MESSAGES,
  );
  if (!taken) {
    return {
      ok: false,
      error: `\`${node}\` has sent ${String(DEFAULT_SCRIPT_MESSAGES)} messages in this run, which is the most it may.`,
    };
  }
  // With no socket, the run's one-second poll finds the row.
  await wakeRun(socketPath(run, home));
  return { ok: true };
};
