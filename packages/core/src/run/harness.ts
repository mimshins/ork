/**
 * @file Ork's own instructions for a Claude node, appended to its system
 *   prompt: who it is, how to report and ask, where it works, whom it owns and
 *   can message, and the claims it should take. Kept short: they cost tokens
 *   every turn.
 */

import type { ClaudeNode, Workflow } from "@krapht/ork-schema";

import type { Claims, Mailbox, Ownership } from "../runtime/types.ts";
import type { Checkout } from "./types.ts";

/** What a node's harness instructions depend on, beyond the node itself. */
export type HarnessOptions = {
  checkout?: Checkout;
  template?: string;
  ownership?: Ownership;
  mailbox?: Mailbox;
  claims?: Claims;
};

const CLAIMS_LINE =
  "- Other nodes may change this project at the same time. Before you edit a file or folder, `claim` it (a path from the project root); if someone holds it, work on something else or ask them. `release` what you are done with; Ork releases the rest when you finish.";

/** Tells a session where it works, so a repo's own worktree rules don't apply. */
export const checkoutInstructions = (checkout: Checkout): string =>
  checkout.own
    ? `- You are already in your own git worktree for this task, on branch \`${checkout.branch}\`, created by Ork. Work and commit here. Do not create another worktree, switch branches, or push; Ork merges your branch when you pass.`
    : `- You work in \`${checkout.owner}\`'s git worktree, on branch \`${checkout.branch}\`, created by Ork. Do not create another worktree, switch branches, or push.`;

const name = (id: string, description?: string): string =>
  description === undefined ? `\`${id}\`` : `\`${id}\` (${description})`;

/** Tells a leader how to hand work to the nodes it owns (ADR-017, ADR-018). */
export const ownershipInstructions = (
  ownership: Ownership,
  checkout?: Checkout,
): string[] => {
  if (ownership.children.length === 0) return [];
  const lines = [
    `- You own ${ownership.children.map(c => name(c.id, c.description)).join(", ")}. Hand them work with \`delegate\`: tasks in one call run in parallel, and it returns their reports when all are done. They do not see this conversation, so give each a self-contained brief: the goal, the files that matter, and what done looks like.`,
  ];
  if (checkout?.own === true) {
    lines.push(
      "- Ork commits your work before delegating and merges each passing child's branch into yours, so their changes are in your checkout when `delegate` returns. Review the reports before you report.",
    );
  }
  const left = ownership.workersLeft();
  if (ownership.templates.length > 0 && left > 0) {
    lines.push(
      `- \`spawn_worker\` starts more instances of ${ownership.templates.map(t => `\`${t}\``).join(", ")} for work that splits into independent parts (${String(left)} left).`,
    );
  }
  return lines;
};

/** Tells a session whom it can message, and an owner that it may be asked. */
export const mailboxInstructions = (
  mailbox: Mailbox,
  owner: boolean,
): string[] => {
  const peers = mailbox.peers();
  const lines =
    peers.length === 0
      ? []
      : [
          `- You can message ${peers.map(p => `\`${p}\``).join(", ")} with \`send_message\`. Ork tells you when a message arrives; read it with \`read_inbox\`.`,
        ];
  if (owner) {
    lines.push(
      "- Ork may ask you about a node you own, such as a loop out of rounds; reply with `answer`.",
    );
  }
  return lines;
};

/** Ork's own instructions for a node, kept short: they cost tokens every turn. */
export const harnessInstructions = (
  workflow: Workflow,
  id: string,
  node: ClaudeNode,
  options: HarnessOptions = {},
): string => {
  const { checkout, template } = options;
  const extra = Object.keys(node.output?.schema ?? {});
  const owner =
    node.parent === undefined ? "" : ` Your owner is \`${node.parent}\`.`;
  const instance =
    template === undefined ? "" : `, an instance of \`${template}\``;
  const lines = [
    "# Ork",
    `You are the \`${id}\` node (${node.type}${instance}) of the Ork workflow \`${workflow.name}\`.${owner}`,
    "- Work on the brief in the first message. Your owner and the user see your final report, not this conversation.",
    `- End with the structured report: \`status\`, a short \`summary\`, and \`artifacts\` (name -> repository-relative path)${extra.length > 0 ? `, plus ${extra.map(f => `\`${f}\``).join(", ")}` : ""}.`,
    "- If you are blocked on a choice only the user can make, call the `ask_user` tool with a clear question, two to four options, and the one you recommend. Never ask about what you can decide or look up yourself.",
  ];
  if (checkout !== undefined) lines.push(checkoutInstructions(checkout));
  if (options.ownership !== undefined) {
    lines.push(...ownershipInstructions(options.ownership, checkout));
  }
  if (options.mailbox !== undefined) {
    lines.push(
      ...mailboxInstructions(options.mailbox, options.ownership !== undefined),
    );
  }
  if (options.claims?.contended() === true) lines.push(CLAIMS_LINE);
  if (node.instructions !== undefined) lines.push("", node.instructions);
  return lines.join("\n");
};
