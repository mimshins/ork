/**
 * @file What the UI draws a workflow or a run from. A draft's graph also says
 *   what the builder needs to offer its conditions as choices (RFC-010). Types
 *   only, so a browser bundle can use it.
 */

import type {
  Condition,
  ConditionRow,
  ConditionTest,
  NodeSays,
  SaidField,
} from "@krapht/ork-core";

export type { Condition, ConditionRow, ConditionTest, NodeSays, SaidField };

export type WorkflowGraph = {
  nodes: { id: string; type: string; parent?: string | undefined }[];
  edges: {
    from: string;
    to: string;
    when?: string | undefined;
    maxRounds?: number | undefined;
    /** The `when:` as the builder's choices; only a draft's graph has it. */
    condition?: Condition | undefined;
  }[];
  channels: (readonly [string, string])[];
  /** What a run may spend, when it recorded a limit; only a run's graph has it. */
  budgetUsd?: number | undefined;
  /** What the workflow file limits in counted tokens (RFC-015). */
  budgetTokens?: number | undefined;
  /** What each node can say; only a draft's graph has it. */
  says?: Readonly<Record<string, NodeSays>> | undefined;
  /** Each `watch.until` as choices, for a draft (RFC-011). */
  untils?: Readonly<Record<string, Condition>> | undefined;
};
