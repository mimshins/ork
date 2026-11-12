/**
 * @file `ork watch --status` and what `--accept` shows of a trigger (RFC-011):
 *   what's live, when each last looked, and what it would run. All of it comes
 *   from a project's files or a check's output, so none of it reaches the
 *   terminal as it is.
 */

import type {
  ProjectTrigger,
  TriggersReport,
  TriggerStanding,
} from "@krapht/ork-core";
import { DEFAULT_RUNS_PER_DAY } from "@krapht/ork-schema";

import { plain, style } from "../output.ts";
import { CHIP_LABELS, chip } from "../term/chips.ts";
import { cut, widthOf } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";

const STANDING: Readonly<Record<string, string>> = {
  live: "live",
  new: "off: new, not accepted",
  changed: "off: changed since it was accepted",
  invalid: "off: has an error",
};

/** A failure's mark: a `FAIL` chip when rich, else the red `✗`. */
const failMark = (term: Term): string =>
  term.rich ? chip(term, CHIP_LABELS.fail, "danger") : style("red", "✗");

/** A warning's mark: a `WARN` chip when rich, else the yellow `!`. */
const warnMark = (term: Term): string =>
  term.rich ? chip(term, CHIP_LABELS.warn, "warn") : style("yellow", "!");

/** A trigger's standing, rich: a chip and what it adds. */
const standingChip = (term: Term, standing: string): string => {
  const live = standing === "live";
  const label = live ? "LIVE" : "OFF";
  const text = STANDING[standing] ?? standing;
  return `${chip(term, label, live ? "ok" : standing === "invalid" ? "danger" : "warn")}${live ? "" : ` ${text.replace(/^off: /u, "")}`}`;
};

export const brokenLines = (
  broken: TriggersReport["broken"],
  term: Term = termOf(process.stdout),
): string[] =>
  broken.map(
    ({ file, message }) =>
      `${failMark(term)} ${plain(file)}: ${plain(message)}`,
  );

export const statusLines = (
  report: TriggersReport,
  term: Term = termOf(process.stdout),
): string[] => {
  const head =
    report.pid === undefined
      ? "ork watch isn't running. Start it with `ork watch`, or `ork watch --detach`."
      : `ork watch is running (process ${String(report.pid)}).`;
  const broken = brokenLines(report.broken, term);
  if (report.triggers.length === 0) {
    return [head, ...broken, "No triggers in any registered project."];
  }
  return [
    head,
    ...broken,
    ...report.triggers.flatMap(status => [
      term.rich
        ? `${style("bold", plain(status.trigger))} ${style("dim", cut(plain(`${status.project} → ${status.run}, every ${status.every}`), Math.max(8, term.width - widthOf(status.trigger) - 1)))}`
        : `${style("bold", plain(status.trigger))} ${style("dim", plain(`${status.project} → ${status.run}, every ${status.every}`))}`,
      `  ${term.rich ? standingChip(term, status.standing) : (STANDING[status.standing] ?? status.standing)}${status.lookedAt === undefined ? "" : `, last looked ${status.lookedAt}`}`,
      ...(status.error === undefined
        ? []
        : [`  last look: ${plain(status.error)}`]),
      ...(status.held === undefined
        ? []
        : [`  waiting: ${plain(status.held)}`]),
      ...status.problems.map(
        problem => `  ${failMark(term)} ${plain(problem)}`,
      ),
    ]),
  ];
};

const asJson = (value: unknown): string => plain(JSON.stringify(value));

/** What a check runs with, past its command. */
const checkSettings = ({ trigger }: ProjectTrigger): string[] => {
  const { check } = trigger;
  if (check === undefined) return [];
  return [
    ...("cwd" in check && check.cwd !== undefined
      ? [`    in: ${plain(check.cwd)}`]
      : []),
    ...(check.env === undefined ? [] : [`    env: ${asJson(check.env)}`]),
    ...("arguments" in check && check.arguments !== undefined
      ? [`    arguments: ${asJson(check.arguments)}`]
      : []),
  ];
};

/** What a trigger runs, in as many words as it takes to judge it. */
const checkLines = (item: ProjectTrigger): string[] => {
  const { check } = item.trigger;
  if (check === undefined) return ["  no check: starts a run every time"];
  if (check.type === "mcp.call") {
    return [
      `  looks with: ${plain(check.server)}.${plain(check.tool)}, from the project's .mcp.json`,
      ...checkSettings(item),
    ];
  }
  return [
    `  looks with: ${plain(check.type)} ${plain(check.command ?? "")}`.trimEnd(),
    ...(check.script === undefined
      ? []
      : check.script
          .trimEnd()
          .split("\n")
          .map(line => `    ${plain(line)}`)),
    ...checkSettings(item),
  ];
};

/** What the run does, since a changed workflow looks the same from outside. */
const workflowLines = ({
  workflow,
  workflowFile,
}: ProjectTrigger): string[] => {
  if (workflow === null) return [];
  const budget = workflow.limits?.budgetUsd;
  const tokens = workflow.limits?.budgetTokens;
  const caps = [
    ...(budget === undefined ? [] : [`$${String(budget)}`]),
    ...(tokens === undefined ? [] : [`${String(tokens)} tokens`]),
  ];
  return [
    `  workflow: ${plain(workflowFile)}${caps.length === 0 ? "" : `, up to ${caps.join(" and ")} a run`}`,
    ...Object.entries(workflow.nodes).map(
      ([id, node]) => `    ${plain(id)}: ${plain(node.type)}`,
    ),
  ];
};

const STANDS: Readonly<Partial<Record<TriggerStanding, string>>> = {
  new: "new",
  changed: "changed since you accepted it, here or in the workflow it starts",
};

export const acceptLines = (
  item: ProjectTrigger,
  standing: TriggerStanding,
  term: Term = termOf(process.stdout),
): string[] => [
  `${style("bold", plain(item.id))} ${style("dim", plain(item.place.root))}`,
  `  ${STANDS[standing] ?? standing}`,
  ...checkLines(item),
  `  starts: ${plain(item.trigger.run)}, looking every ${item.trigger.every}, with up to ${String(item.trigger.maxRunsPerDay ?? DEFAULT_RUNS_PER_DAY)} runs a day`,
  ...workflowLines(item),
  ...item.diagnostics
    .filter(({ severity }) => severity === "warning")
    .map(({ message }) => `  ${warnMark(term)} ${plain(message)}`),
];

/** The triggers `--accept` can't offer, so they aren't silently left out. */
export const unacceptableLines = (
  item: ProjectTrigger,
  term: Term = termOf(process.stdout),
): string[] => [
  `${style("bold", plain(item.id))} ${style("dim", plain(item.place.root))}`,
  ...item.diagnostics
    .filter(({ severity }) => severity === "error")
    .map(({ message }) => `  ${failMark(term)} ${plain(message)}`),
];
