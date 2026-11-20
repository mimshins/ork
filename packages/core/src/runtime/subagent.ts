/**
 * @file A Claude Code subagent a session can hand work to, as the runtime port
 *   carries it (`SessionSpec.agents`).
 */

/** A Claude Code subagent the session can hand work to (`agent.subagent`). */
export type SubagentSpec = {
  description: string;
  /** Its system prompt. */
  prompt: string;
  model?: string;
  /** The only tools it has; all of the session's when unset. */
  tools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
};
