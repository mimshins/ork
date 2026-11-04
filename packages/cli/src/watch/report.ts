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

const STANDING: Readonly<Record<string, string>> = {
  live: "live",
  new: "off: new, not accepted",
  changed: "off: changed since it was accepted",
  invalid: "off: has an error",
};

export const brokenLines = (broken: TriggersReport["broken"]): string[] =>
  broken.map(
    ({ file, message }) =>
      `${style("red", "✗")} ${plain(file)}: ${plain(message)}`,
  );

export const statusLines = (report: TriggersReport): string[] => {
  const head =
    report.pid === undefined
      ? "ork watch isn't running. Start it with `ork watch`, or `ork watch --detach`."
      : `ork watch is running (process ${String(report.pid)}).`;
  const broken = brokenLines(report.broken);
  if (report.triggers.length === 0) {
    return [head, ...broken, "No triggers in any registered project."];
  }
  return [
    head,
    ...broken,
    ...report.triggers.flatMap(status => [
      `${style("bold", plain(status.trigger))} ${style("dim", plain(`${status.project} → ${status.run}, every ${status.every}`))}`,
      `  ${STANDING[status.standing] ?? status.standing}${status.lookedAt === undefined ? "" : `, last looked ${status.lookedAt}`}`,
      ...(status.error === undefined
        ? []
        : [`  last look: ${plain(status.error)}`]),
      ...(status.held === undefined
        ? []
        : [`  waiting: ${plain(status.held)}`]),
      ...status.problems.map(
        problem => `  ${style("red", "✗")} ${plain(problem)}`,
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
  return [
    `  workflow: ${plain(workflowFile)}${budget === undefined ? "" : `, up to $${String(budget)} a run`}`,
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
): string[] => [
  `${style("bold", plain(item.id))} ${style("dim", plain(item.place.root))}`,
  `  ${STANDS[standing] ?? standing}`,
  ...checkLines(item),
  `  starts: ${plain(item.trigger.run)}, looking every ${item.trigger.every}, with up to ${String(item.trigger.maxRunsPerDay ?? DEFAULT_RUNS_PER_DAY)} runs a day`,
  ...workflowLines(item),
  ...item.diagnostics
    .filter(({ severity }) => severity === "warning")
    .map(({ message }) => `  ${style("yellow", "!")} ${plain(message)}`),
];

/** The triggers `--accept` can't offer, so they aren't silently left out. */
export const unacceptableLines = (item: ProjectTrigger): string[] => [
  `${style("bold", plain(item.id))} ${style("dim", plain(item.place.root))}`,
  ...item.diagnostics
    .filter(({ severity }) => severity === "error")
    .map(({ message }) => `  ${style("red", "✗")} ${plain(message)}`),
];
