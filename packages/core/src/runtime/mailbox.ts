/**
 * @file A session's place on its run's message bus, and a run's way to nodes of
 *   other runs: the ports a driver's message tools call.
 */

/** How a message came, when no session wrote it: `ork send`, or a `notify:`. */
export type MessageVia = "script" | "rule";

export type InboxMessage = {
  id: number;
  from: string;
  body: string;
  via?: MessageVia;
};

export type SendResult =
  | { ok: true; delivered: "now" | "queued" }
  | { ok: false; error: string };

/**
 * A node's place on the run's message bus: whom it may write to, its inbox, and
 * the owner questions it answers. The bus pushes a one-line notice into a live
 * session; the session pulls the bodies with `read`.
 */
export type Mailbox = {
  /** Its owner, its children (and their spawned instances), its channels. */
  peers: () => string[];
  send: (to: string, body: string) => SendResult;
  /** Unread messages, oldest first; they count as read after this. */
  read: () => InboxMessage[];
  /** How many messages are unread, without reading them. */
  pending: () => number;
  /** A `workflow.call` node now stands for this `<run>/<node>` (RFC-004). */
  alias: (address: string) => void;
  /** Whether this session may be linked to a node of another run later. */
  linkable: () => boolean;
  /** Whether a program or a rule of this workflow may write to it. */
  hears: () => boolean;
  /**
   * Waits for a message, for at most `ms`, giving up the session's slot
   * meanwhile. Ends early when there is one, when Ork has something to tell the
   * session (a link was made), or when the session ends.
   */
  wait: (ms: number) => Promise<void>;
  /** Answers a question Ork asked this node as an owner. */
  answer: (
    question: string,
    choice: string,
  ) => { ok: true } | { ok: false; error: string };
  /**
   * Connects the node's live session: notices go to `deliver` until the
   * returned function disconnects it. Questions still open then go back to
   * whoever asked, unanswered.
   */
  connect: (deliver: (text: string) => void) => () => void;
};

/** A run's way to nodes of other runs, for nodes the user linked (RFC-003). */
export type RelayPort = {
  /** Who `node` is linked to, as `<run>/<node>`. */
  peers: (node: string) => string[];
  send: (node: string, to: string, body: string) => SendResult;
};
