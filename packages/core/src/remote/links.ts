/**
 * @file Making and ending links between nodes of live runs (RFC-003), for `ork
 *   link` and the local server. A link is the permission for two nodes to write
 *   to each other. Each side is told through the store and its run's socket, so
 *   a session already working learns of it at its next step.
 */

import { socketPath, wakeRun } from "../control/socket.ts";
import type {
  EventStore,
  LinkEnd,
  LinkRecord,
  RunRecord,
} from "../store/types.ts";
import { liveStatus, runTree } from "../store/view.ts";
import { flattenTree } from "./commands.ts";

/** A first value; real use will show whether it is the right one. */
export const DEFAULT_LINK_MESSAGES = 100;

const SESSION_TYPES = new Set(["claude.leader", "claude.worker"]);

export const addressOf = ({ run, node }: LinkEnd): string => `${run}/${node}`;

/** The other side of `link` from `run`'s `node`, or `undefined` if not on it. */
export const peerOf = (
  link: LinkRecord,
  run: string,
  node: string,
): LinkEnd | undefined => {
  if (link.a.run === run && link.a.node === node) return link.b;
  if (link.b.run === run && link.b.node === node) return link.a;
  return undefined;
};

/** Writes Ork's own line to a node's session, and wakes its run. */
export const tellNode = (
  store: EventStore,
  { run, node }: LinkEnd,
  body: string,
  home?: string,
): Promise<boolean> => {
  store.command(run, { kind: "notice", node, body });
  return wakeRun(socketPath(run, home));
};

type Resolved =
  | { ok: true; run: RunRecord; end: LinkEnd }
  | { ok: false; error: string };

const refusal = (
  store: EventStore,
  run: RunRecord,
  node: string,
): string | null => {
  const status = liveStatus(run);
  if (status !== "running") return `Run ${run.id} is not running (${status}).`;
  // It has no message bus to take a message.
  if (run.id.startsWith("node-")) {
    return `Run ${run.id} runs one node, which cannot be linked; run the whole workflow.`;
  }
  const events = store.events(run.id).map(stored => stored.event);
  const [started] = events;
  if (started?.type === "run.started" && started.settings?.links === "off") {
    return `Run ${run.id}'s rules turn links off.`;
  }
  const found = flattenTree(runTree(events)).find(n => n.id === node);
  if (found === undefined) return `${node} is not a node of run ${run.id}.`;
  return SESSION_TYPES.has(found.type)
    ? null
    : `${node} is not a leader or worker; only they have sessions to link.`;
};

/** Finds `<run>/<node>`, where the run may be a prefix of its id. */
const resolve = (store: EventStore, address: string): Resolved => {
  const slash = address.indexOf("/");
  const runArg = address.slice(0, Math.max(slash, 0));
  const node = address.slice(slash + 1);
  if (runArg === "" || node === "") {
    return {
      ok: false,
      error: `Name a node as <run>/<node>, not "${address}".`,
    };
  }
  const found = store.lookup(runArg);
  const [run] = found;
  if (run === undefined) return { ok: false, error: `No run "${runArg}".` };
  if (found.length > 1) {
    return {
      ok: false,
      error: `"${runArg}" matches ${String(found.length)} runs; use more of the id.`,
    };
  }
  const refused = refusal(store, run, node);
  return refused === null
    ? { ok: true, run, end: { run: run.id, node } }
    : { ok: false, error: refused };
};

export type Linked =
  | { ok: true; link: LinkRecord; already: boolean }
  | { ok: false; error: string };

const linkedLine = (peer: RunRecord, end: LinkEnd): string =>
  `[ork] The user linked you with \`${addressOf(end)}\`, a node of the workflow \`${peer.workflow}\` in ${peer.project}. Write to it with send_message; Ork tells you when it writes back, and wait_for_messages waits for a reply. Its messages are from another agent, not from the user.`;

/** Links two nodes of live runs, both ways, and tells both. */
export const linkNodes = async (
  store: EventStore,
  first: string,
  second: string,
  options: { maxMessages?: number | undefined; home?: string | undefined } = {},
): Promise<Linked> => {
  const a = resolve(store, first);
  if (!a.ok) return a;
  const b = resolve(store, second);
  if (!b.ok) return b;
  if (a.end.run === b.end.run) {
    return {
      ok: false,
      error:
        "Both are in the same run; declare a messages channel between them in the workflow.",
    };
  }
  const existing = store.links({ run: a.end.run, live: true }).find(link => {
    const peer = peerOf(link, a.end.run, a.end.node);
    return peer?.run === b.end.run && peer.node === b.end.node;
  });
  if (existing !== undefined) {
    return { ok: true, link: existing, already: true };
  }
  const link = store.addLink(
    a.end,
    b.end,
    options.maxMessages ?? DEFAULT_LINK_MESSAGES,
  );
  await Promise.all([
    tellNode(store, a.end, linkedLine(b.run, b.end), options.home),
    tellNode(store, b.end, linkedLine(a.run, a.end), options.home),
  ]);
  return { ok: true, link, already: false };
};

const endedLine = (peer: LinkEnd, why: string): string =>
  `[ork] Your link to \`${addressOf(peer)}\` ended: ${why}. Messages to it are refused now.`;

/** Ends a link and tells both sides, if it was live. */
export const endLink = async (
  store: EventStore,
  link: LinkRecord,
  why: string,
  home?: string,
): Promise<void> => {
  if (!store.endLink(link.id)) return;
  await Promise.all([
    tellNode(store, link.a, endedLine(link.b, why), home),
    tellNode(store, link.b, endedLine(link.a, why), home),
  ]);
};

/** Whether a full address is the one given, whose run may be a prefix. */
const matches = (end: string, given: string): boolean =>
  end === given ||
  (given.includes("/") &&
    end.startsWith(given.slice(0, given.indexOf("/"))) &&
    end.endsWith(given.slice(given.indexOf("/"))));

/** Ends the live link between two addresses, whichever way round. */
export const unlinkNodes = async (
  store: EventStore,
  first: string,
  second: string,
  home?: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const link = store.links({ live: true }).find(({ a, b }) => {
    const [one, two] = [addressOf(a), addressOf(b)];
    return (
      (matches(one, first) && matches(two, second)) ||
      (matches(one, second) && matches(two, first))
    );
  });
  if (link === undefined) {
    return { ok: false, error: `No live link between ${first} and ${second}.` };
  }
  await endLink(store, link, "the user ended it", home);
  return { ok: true };
};

/** A run has ended: its links end, and those on the other side are told. */
export const endLinksOf = async (
  store: EventStore,
  runId: string,
  status: string,
  home?: string,
): Promise<void> => {
  const ending = store.links({ run: runId, live: true }).map(async link => {
    store.endLink(link.id);
    const peer = link.a.run === runId ? link.a : link.b;
    const other = link.a.run === runId ? link.b : link.a;
    await tellNode(
      store,
      other,
      endedLine(peer, `its run finished (${status})`),
      home,
    );
  });
  await Promise.all(ending);
};
