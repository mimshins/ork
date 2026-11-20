/**
 * @file What a run's workspace is made from: the graph, the run, the project's
 *   git root and base commit, and for a resumed run what its events say it left
 *   (ADR-020).
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { NodeOutput, RunEvent } from "../run/types.ts";
import type { NameInputs } from "./names.ts";
import type { AdoptedWorktree } from "./resumed.ts";

export type WorkspaceOptions = {
  graph: CompiledGraph;
  runId: string;
  /** The project's git root and the commit root nodes branch from. */
  root: string;
  head: string;
  /** The run's inputs, for `{inputs.<name>}` in the git rules' templates. */
  inputs?: NameInputs;
  onEvent: (event: RunEvent) => void;
  /** Worktrees a resumed run left whose folders are still there. */
  adopt?: readonly AdoptedWorktree[];
  /** Where a resumed run's nodes last worked (their sessions' folders). */
  places?: ReadonlyMap<string, string>;
  /** Branches this run created before (a resumed run), which it may reuse. */
  known?: readonly string[];
  /** A resumed run's replayed outputs, for where its tool nodes worked. */
  replayed?: ReadonlyMap<string, NodeOutput>;
  /**
   * `root` is the run's own worktree at the base (a run root, RFC-021):
   * readonly nodes read it, and `git.readonly: base` opens no other.
   */
  runRoot?: boolean;
};
