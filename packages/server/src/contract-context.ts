/**
 * @file The context inspector's part of the API's contract: what one node's
 *   session would load, for a run's node (planned from the run's workflow file
 *   as it is now) or for a node in the builder (planned from the draft, else
 *   the file). Like the rest of the contract it imports only types, so a
 *   browser bundle can use it.
 */

import type { Explanation } from "@krapht/ork-core";

export type { Explanation };

/**
 * A node's context, or why it can't be planned (a node that isn't a Claude
 * session, or a workflow with errors), in the planner's words.
 */
export type NodeContextAnswer = (
  | { planned: true; explanation: Explanation }
  | { planned: false; why: string }
) & {
  /**
   * For a run's node: the files behind it (the workflow file, its agents,
   * instructions, skills and context) that changed after the run started, so
   * this may not be what the run loaded. Project-relative, or `~/…`.
   */
  changedSinceStart: string[];
};

export const CONTEXT_API = {
  runContext: { method: "GET", path: "/api/runs/:id/nodes/:node/context" },
  builderContext: {
    method: "GET",
    path: "/api/projects/:id/builder/:name/nodes/:node/context",
  },
} as const;

/** What each context route answers with, on success. */
export type ContextResponses = {
  runContext: NodeContextAnswer;
  builderContext: NodeContextAnswer;
};
