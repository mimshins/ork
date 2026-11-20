/**
 * @file The terminal's answer to a permission prompt: a yes-or-no, or, when the
 *   prompt offers to allow for this node, this run or always (RFC-028), a list
 *   of its choices with the rules each one adds in its description.
 */

import type { DecisionChoice, HumanChannel } from "@krapht/ork-core";

import { doneLine } from "./human-card.ts";
import { plain } from "./output.ts";
import { confirmOrStop } from "./term/confirm.ts";
import type { PromptIO } from "./term/mode.ts";
import { select, type SelectOption } from "./term/select.ts";

type Allowed = Extract<
  Awaited<ReturnType<HumanChannel["permit"]>>,
  { allow: true }
>;

/** A permission answer's reach past its call, by the answer's id. */
const SCOPES = new Map<string, Allowed["scope"] & string>([
  ["allow-node", "node"],
  ["allow-run", "run"],
  ["allow-always", "always"],
]);

/** A decision's choices as the select prompt lists them, escapes gone. */
export const selectOptions = (
  choices: readonly DecisionChoice[],
): SelectOption[] =>
  choices.map(o => ({
    id: o.id,
    ...(o.label === undefined ? {} : { label: plain(o.label) }),
    ...(o.description === undefined
      ? {}
      : { description: plain(o.description) }),
  }));

/**
 * Asks whether `nodeId` may make its call: the allow with its scope, a denial,
 * or `null` on Ctrl-C (the run stops; no note is asked for).
 */
export const askPermit = async (
  kit: PromptIO,
  nodeId: string,
  options: readonly DecisionChoice[] | undefined,
  signal: AbortSignal | undefined,
): Promise<Allowed | { allow: false } | null> => {
  if (options?.some(o => SCOPES.has(o.id)) !== true) {
    const allowed = await confirmOrStop(kit, {
      question: "Allow?",
      ...(signal === undefined ? {} : { signal }),
    });
    if (allowed === null) return null;
    return allowed ? { allow: true } : { allow: false };
  }
  const result = await select(kit, {
    options: selectOptions(options),
    done: (answer, t) => doneLine(t, undefined, nodeId, answer),
    ...(signal === undefined ? {} : { signal }),
  });
  if (result.kind === "interrupted") return null;
  if (result.kind !== "chosen" || result.id === "deny") return { allow: false };
  const scope = SCOPES.get(result.id);
  return scope === undefined ? { allow: true } : { allow: true, scope };
};
