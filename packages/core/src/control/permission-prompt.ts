/**
 * @file A permission prompt as a decision: its question and options, the tool
 *   input shown as its context, the message a session gets on a deny, and how a
 *   yolo run (`ork run --yolo`) records a prompt it allowed itself, opened and
 *   answered `allow` by `yolo` at once, so the log and `ork ui` show what ran
 *   with nobody asked. A shell line with rules Ork can offer (RFC-028) also
 *   gets allow for this node, this run, or always, each naming its rules; the
 *   rules a run remembers are rebuilt from its answered decisions.
 */

import { readShellLine } from "../run/shell-line.ts";
import { ruleFor } from "../run/shell-rule.ts";
import type { RunEvent } from "../run/types.ts";
import type { DecisionChoice, PermitScope } from "../runtime/human.ts";
import type {
  DecisionRecord,
  DecisionStore,
  NewDecision,
} from "../store/types.ts";

/** What a session asks permission for. */
export type PermissionAsk = {
  nodeId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** The rules a person may allow past this call; none: allow or deny. */
  rules?: readonly string[] | undefined;
};

export const PERMISSION_OPTIONS: DecisionChoice[] = [
  { id: "allow", label: "Allow" },
  { id: "deny", label: "Deny" },
];

const SCOPES = new Map<string, PermitScope>([
  ["allow-node", "node"],
  ["allow-run", "run"],
  ["allow-always", "always"],
]);

/** How far an answer allows past its call; none for `allow` and `deny`. */
export const scopeOf = (answer: string | undefined): PermitScope | undefined =>
  SCOPES.get(answer ?? "");

/** Whether a permission decision's answer allows the call. */
export const allows = (answer: string): boolean =>
  answer === "allow" || scopeOf(answer) !== undefined;

/**
 * A prompt's options: allow and deny, and with rules also allow for this node,
 * this run and, when the project's rules file is known, always; the rules are
 * in each description, which is where a resume reads them back.
 */
export const permissionOptions = (
  rules: readonly string[] = [],
  rulesFile?: string,
): DecisionChoice[] => {
  if (rules.length === 0) return PERMISSION_OPTIONS;
  const listed = rules.map(rule => `\`${rule}\``).join(", ");
  return [
    { id: "allow", label: "Allow", description: "Allow this call only." },
    {
      id: "allow-node",
      label: "Allow for this node",
      description: `Allow this call, and ${listed} for this node for the rest of the run.`,
    },
    {
      id: "allow-run",
      label: "Allow for this run",
      description: `Allow this call, and ${listed} for every node for the rest of the run.`,
    },
    ...(rulesFile === undefined
      ? []
      : [
          {
            id: "allow-always",
            label: "Always allow",
            description: `Add ${listed} to permissions.allow in ${rulesFile}, and allow them for the rest of the run.`,
          },
        ]),
    { id: "deny", label: "Deny" },
  ];
};

/** A rule as an option's description names it. */
const RULE = /Bash\([^()]*\)/gu;

/**
 * The rules a person allowed past the call of `decision`: those its context's
 * commands give (`ruleFor`) that the chosen option's description names, so
 * never one the person was not shown.
 */
const allowedRules = (decision: DecisionRecord): string[] => {
  const chosen = decision.options.find(each => each.id === decision.answer);
  const listed: readonly string[] = chosen?.description?.match(RULE) ?? [];
  const commands = readShellLine(decision.context ?? "")?.commands ?? [];
  return commands.flatMap(command => {
    const rule = ruleFor(command);
    return rule !== null && listed.includes(rule) ? [rule] : [];
  });
};

/**
 * Whether `rules` (some) are all among those `node` may use without asking: the
 * rules of the run's permission decisions answered for that node, for the run,
 * or always.
 */
export const remembered = (
  decisions: readonly DecisionRecord[],
  node: string,
  rules: readonly string[],
): boolean => {
  if (rules.length === 0) return false;
  const known = new Set(
    decisions.flatMap(decision => {
      const scope =
        decision.kind === "permission" && decision.status === "answered"
          ? scopeOf(decision.answer)
          : undefined;
      return scope === undefined || (scope === "node" && decision.node !== node)
        ? []
        : allowedRules(decision);
    }),
  );
  return rules.every(rule => known.has(rule));
};

/** The answer id for the terminal's allow: its scope's, when offered. */
export const allowAnswer = (
  scope: PermitScope | undefined,
  offered: readonly DecisionChoice[],
): string => {
  const id = scope === undefined ? "allow" : `allow-${scope}`;
  return offered.some(each => each.id === id) ? id : "allow";
};

/** Where an "always" answer's rules go: the decision queue's options. */
export type AlwaysOptions = {
  /**
   * The project's rules file an "always" answer adds its rules to; without it a
   * prompt offers no "always".
   */
  rulesFile?: string;
  /** Adds an "always" answer's rules to `rulesFile`. */
  rememberAlways?: (rules: string[]) => Promise<void> | void;
  /** Tells the run's terminal something went wrong that fails nothing. */
  warn?: (text: string) => void;
};

/**
 * Hands an "always" answer's rules to the project's rules file; a failure only
 * warns, since the stored answer already allows them for the run.
 */
export const keepAlways = async (
  rules: readonly string[],
  to: AlwaysOptions,
): Promise<void> => {
  try {
    await to.rememberAlways?.([...rules]);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    to.warn?.(
      `Ork could not add ${rules.join(", ")} to ${to.rulesFile ?? "the project's rules"} (${why}); they are allowed for the rest of this run.`,
    );
  }
};

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
  rulesFile?: string,
): Omit<NewDecision, "id" | "runId"> => ({
  node: ask.nodeId,
  kind: "permission",
  question: `Allow ${ask.toolName}?`,
  options: permissionOptions(ask.rules, rulesFile),
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
    // Nobody chooses a scope: yolo allows each call as it comes.
    ...permissionDecision({ ...ask, rules: [] }),
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
