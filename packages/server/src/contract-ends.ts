/**
 * @file How a node ended, as the API serves it (specs/ui/design-components-and-
 *   copy.md): an `EndView` is core's `SessionEnd` with its registry entry
 *   resolved (label, who acts, hint), so the UI renders it and never imports
 *   core. The stored events and the tree carry it. Types only, so a browser
 *   bundle can use it.
 */

import type {
  EndActor,
  RunEvent,
  StoredEvent as CoreStoredEvent,
  TreeNode as CoreTreeNode,
} from "@krapht/ork-core";

export type EndView = {
  /** An end kind's id; the UI treats it as opaque text. */
  kind: string;
  /** Ork's sentence, without the node's name. */
  message: string;
  /** The raw text, scrubbed and capped; shown on request. */
  detail?: string;
  label: string;
  /** `null` for a node that finished well. */
  actor: EndActor | null;
  transient: boolean;
  /** What to do about it; `""` when there is nothing to do. */
  hint: string;
  docsAnchor: string;
};

type Finished = Extract<RunEvent, { type: "node.finished" }>;

/** A run event as the API serves it: a finished node always has its `end`. */
export type ServedEvent =
  | Exclude<RunEvent, Finished>
  | (Omit<Finished, "end"> & { end: EndView });

export type StoredEvent = Omit<CoreStoredEvent, "event"> & {
  event: ServedEvent;
};

/** A node of the ownership tree, with how its latest round ended. */
export type TreeNode = Omit<CoreTreeNode, "children"> & {
  end?: EndView;
  children: TreeNode[];
};
