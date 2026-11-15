/**
 * @file A permission prompt as a decision: its question and options, the tool
 *   input shown as its context, the message a session gets on a deny, and how a
 *   yolo run (`ork run --yolo`) records a prompt it allowed itself, opened and
 *   answered `allow` by `yolo` at once, so the log and `ork ui` show what ran
 *   with nobody asked.
 */

import type { RunEvent } from "../run/types.ts";
import type { DecisionStore, NewDecision } from "../store/types.ts";

/** What a session asks permission for. */
export type PermissionAsk = {
  nodeId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export const PERMISSION_OPTIONS = [
  { id: "allow", label: "Allow" },
  { id: "deny", label: "Deny" },
];

export const DENIED = "The user did not allow this tool.";

/** The deny message a session gets, with the person's words when given. */
export const deniedMessage = (note: string | undefined): string =>
  note === undefined ? DENIED : `${DENIED} They said: ${note}`;

/** The input fields that say what a tool will do, the first one present. */
export const TOOL_INPUT_KEYS = [
  "command",
  "file_path",
  "path",
  "url",
  "pattern",
] as const;

/** A tool's input for the decision's context: as written, cut at `max`. */
const inputContext = (input: Record<string, unknown>, max = 4000): string => {
  const key = TOOL_INPUT_KEYS.find(k => typeof input[k] === "string");
  const text =
    key === undefined
      ? JSON.stringify(input, undefined, 2)
      : String(input[key]);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The decision a permission prompt opens. */
export const permissionDecision = (
  ask: PermissionAsk,
): Omit<NewDecision, "id" | "runId"> => ({
  node: ask.nodeId,
  kind: "permission",
  question: `Allow ${ask.toolName}?`,
  options: PERMISSION_OPTIONS,
  context: inputContext(ask.input),
});

/** Records the decision `id` of a yolo run, opened and allowed at once. */
export const allowedByYolo = (
  store: DecisionStore,
  emit: (event: RunEvent) => void,
  decision: { id: string; runId: string },
  ask: PermissionAsk,
): void => {
  const record = store.openDecision({
    ...permissionDecision(ask),
    ...decision,
  });
  emit({
    type: "decision.opened",
    node: record.node,
    decision: decision.id,
    kind: "permission",
    question: record.question,
    options: record.options,
  });
  store.answerDecision(decision.id, "allow", "yolo");
  emit({
    type: "decision.answered",
    node: record.node,
    decision: decision.id,
    answer: "allow",
    by: "yolo",
  });
};
