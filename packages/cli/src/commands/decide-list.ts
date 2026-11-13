/**
 * @file The list `ork decide --list` prints: one line per open decision, and
 *   the filters (RFC-017) that choose which.
 */

import {
  type DecisionRecord,
  decisionListTable,
  type EventStore,
  pendingDecisions,
  placeFor,
} from "@krapht/ork-core";

import { projectScope, fail, readListArgs, resolveRun } from "../list/flags.ts";
import { printList } from "../list/print.ts";
import { plain, write } from "../output.ts";
import { chip, CHIP_LABELS, nodeChip } from "../term/chips.ts";
import { cut } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";
import { bold } from "../term/theme.ts";

/**
 * One line per open decision, for `--list`: on a terminal an ASK chip and the
 * node's chip with the id and the question after, cut to the screen; plain, the
 * id, the node and the question.
 */
export const formatDecisions = (
  decisions: readonly DecisionRecord[],
  workflow?: string,
  t: Term = termOf(process.stdout),
): string[] => {
  if (decisions.length === 0) {
    return [
      workflow === undefined
        ? "No open decisions."
        : `No open decisions in workflow ${workflow}.`,
    ];
  }
  const idWidth = Math.max(...decisions.map(d => d.id.length));
  const nodeWidth = Math.max(...decisions.map(d => plain(d.node).length));
  return decisions.map(d => {
    const node = plain(d.node);
    const options = `[${d.options.map(o => (o.id === d.recommended ? `${o.id}*` : o.id)).join(", ")}]`;
    const document = d.document === undefined ? "" : " +document";
    const via = d.owner === undefined ? "" : ` via ${plain(d.owner)}`;
    if (!t.rich) {
      return `${d.id}  ${node}${via}  ${plain(d.question)}${document} ${options}`;
    }
    const lead = `${chip(t, CHIP_LABELS.ask, "accent")} ${nodeChip(t, node)}${" ".repeat(nodeWidth - node.length)} ${bold(t, d.id.padEnd(idWidth))}  `;
    // The lead is `ASK  node  id  ` wide; the question gets the rest.
    const room = Math.max(20, t.width - (7 + nodeWidth + 2 + idWidth + 2));
    const tail = cut(`${plain(d.question)}${document} ${options}${via}`, room);
    return `${lead}${tail}`;
  });
};

type DecideArgs = Readonly<Record<string, unknown>>;

/**
 * Whether the flags ask for a list: any flag that shapes one means listing, so
 * a terminal never starts answering by accident.
 */
export const asksForList = (args: DecideArgs): boolean =>
  args["list"] === true ||
  args["json"] === true ||
  args["ids"] === true ||
  args["limit"] !== undefined;

/**
 * The open decisions `args` ask for (filter, then the store's order, then
 * `--limit`), and the workflow filter given. `undefined` when a flag was
 * refused (said, exit code set).
 */
export const selectDecisions = (
  store: EventStore,
  args: DecideArgs,
): { open: DecisionRecord[]; workflow: string | undefined } | undefined => {
  const request = readListArgs(decisionListTable, args);
  if (request === undefined) return undefined;
  const scope = projectScope(request.filter, store.projects());
  if (scope === undefined) return undefined;
  const filter: { runId?: string; project?: string; workflow?: string } = {};
  const { workflow } = request.filter;
  if (workflow !== undefined) filter.workflow = workflow;
  const positional = args["run-id"];
  const named =
    request.filter["run"] ??
    (typeof positional === "string" ? positional : undefined);
  const hint =
    named !== undefined && request.filter["run"] === undefined
      ? decisionHint(store, named)
      : undefined;
  if (hint !== undefined) {
    fail(hint);
    return undefined;
  }
  const resolved = resolveRun(
    store,
    named === undefined ? request.filter : { ...request.filter, run: named },
  );
  if (resolved === undefined) return undefined;
  const run = resolved["run"];
  if (run !== undefined && run !== "") {
    filter.runId = run;
  } else if (scope === "here") {
    filter.project = placeFor(process.cwd(), store.projects()).root;
  } else if (scope !== "all") {
    filter.project = scope.root;
  }
  const pending = pendingDecisions(store, filter);
  const open =
    request.limit === undefined ? pending : pending.slice(0, request.limit);
  return { open, workflow };
};

/** Prints `open` as `--ids`, `--json` or the lines of `formatDecisions`. */
export const printDecisions = (
  open: readonly DecisionRecord[],
  args: DecideArgs,
  workflow: string | undefined,
): void => {
  printList(open, decisionListTable, args, shown => {
    for (const line of formatDecisions(shown, workflow)) write(line);
  });
};

/**
 * What to say when the positional meant for a run is an open decision's id: the
 * form that answers it (a run id is the positional; a decision answers with
 * `--id` and `--choose`).
 */
export const decisionHint = (
  store: EventStore,
  arg: string,
): string | undefined => {
  const decision = store.decision(arg);
  if (decision === undefined || decision.status !== "open") return undefined;
  const choice = decision.recommended ?? decision.options[0]?.id ?? "<option>";
  return `${arg} is a decision id, not a run: answer it with \`ork decide --id ${arg} --choose ${choice}\``;
};
