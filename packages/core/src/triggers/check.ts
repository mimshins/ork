/**
 * @file Checking `triggers.yaml` against the project's workflows (RFC-011):
 *   nothing can start that has no spending cap or doesn't exist, and a prompt
 *   that reads what a stranger can write, on a session with broad tools, is
 *   worth a warning. Ork can't prove a workflow safe, so that isn't a refusal.
 */

import {
  type Diagnostic,
  isClaudeNode,
  type Node,
  type Trigger,
  type TriggerCheck,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate } from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { error, warning } from "../graph/diagnostics.ts";

/** The inputs a node's prompt or instructions read. */
const promptReads = (node: Node): string[] => {
  if (!isClaudeNode(node)) return [];
  return [node.prompt, node.instructions].flatMap(text => {
    const parsed = text === undefined ? null : parseTemplate(text);
    if (parsed === null || !parsed.ok) return [];
    return parsed.parts.flatMap(part =>
      typeof part === "string"
        ? []
        : collectPaths(part.expr).flatMap(([root, name]) =>
            root === "inputs" && name !== undefined ? [String(name)] : [],
          ),
    );
  });
};

/** What can read but not act: a prompt a stranger writes can't do much with it. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob"]);

/** Whether a session's tools stop at reading. */
const toolsAreNarrow = (node: Node): boolean =>
  isClaudeNode(node) &&
  node.tools?.only !== undefined &&
  node.tools.only.every(tool => READ_ONLY_TOOLS.has(tool));

/** The inputs a run of this trigger takes from what its check reported. */
const untrustedInputs = (trigger: Trigger, workflow: Workflow): string[] =>
  trigger.check === undefined
    ? []
    : Object.keys(workflow.inputs ?? {}).filter(
        name => !Object.hasOwn(trigger.inputs ?? {}, name),
      );

const untrustedWarnings = (
  id: string,
  trigger: Trigger,
  workflow: Workflow,
): Diagnostic[] => {
  const untrusted = new Set(untrustedInputs(trigger, workflow));
  return Object.entries(workflow.nodes).flatMap(([nodeId, node]) => {
    if (!isClaudeNode(node) || toolsAreNarrow(node)) return [];
    return [...new Set(promptReads(node))]
      .filter(name => untrusted.has(name))
      .map(name =>
        warning(
          "trigger.untrusted",
          `${trigger.run}'s ${nodeId} reads inputs.${name} in its prompt, which comes from what ${id} found, with tools that can act: anyone who can write there can talk to that session. Give the node tools: { only: [Read, Grep, Glob] }, or read fields by number`,
          ["triggers", id, "run"],
        ),
      );
  });
};

/** Where a string under `value` has a template, as paths from `at`. */
const templatesIn = (value: unknown, at: readonly string[]): string[][] => {
  if (typeof value === "string") return value.includes("{{") ? [[...at]] : [];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    templatesIn(item, [...at, key]),
  );
};

/** A check's `env:` may read the user's own variables, and nothing else. */
const envProblems = (check: TriggerCheck, at: readonly string[]): string[][] =>
  Object.entries(check.env ?? {}).flatMap(([name, value]) => {
    const parsed = parseTemplate(value);
    const reads = parsed.ok
      ? parsed.parts.flatMap(part =>
          typeof part === "string" ? [] : collectPaths(part.expr),
        )
      : [["unreadable"]];
    return reads.some(([root]) => root !== "env") ? [[...at, "env", name]] : [];
  });

const checkProblems = (id: string, check: TriggerCheck): Diagnostic[] => {
  const path = ["triggers", id, "check"];
  const nested = ["watch", "notify"].flatMap(field =>
    Reflect.get(check, field) === undefined
      ? []
      : [
          error(
            "trigger.check",
            `a check has no ${field}: ork watch does the looking, and starts the run`,
            [...path, field],
          ),
        ],
  );
  // `script:` takes no templates anywhere, so `{{` in one is only text.
  const read = Object.entries(check).filter(
    ([field]) => field !== "script" && field !== "env",
  );
  const templated = [
    ...templatesIn(Object.fromEntries(read), path),
    ...envProblems(check, path),
  ];
  return [
    ...nested,
    ...templated.map(at =>
      error(
        "trigger.check",
        "a check has no inputs to read, so it takes no templates",
        at,
      ),
    ),
  ];
};

const inputProblems = (
  id: string,
  trigger: Trigger,
  workflow: Workflow,
): Diagnostic[] => {
  const declared = workflow.inputs ?? {};
  const given = trigger.inputs ?? {};
  const unknown = Object.keys(given)
    .filter(name => !Object.hasOwn(declared, name))
    .map(name =>
      error("trigger.input", `${trigger.run} declares no input "${name}"`, [
        "triggers",
        id,
        "inputs",
        name,
      ]),
    );
  // A schedule has nothing else to fill them from.
  const missing =
    trigger.check === undefined
      ? Object.entries(declared)
          .filter(
            ([name, input]) =>
              input.required === true &&
              input.default === undefined &&
              !Object.hasOwn(given, name),
          )
          .map(([name]) =>
            error(
              "trigger.input",
              `${trigger.run} requires input "${name}", and a trigger with no check has only its own inputs`,
              ["triggers", id, "inputs"],
            ),
          )
      : [];
  return [...unknown, ...missing];
};

/** What's wrong with one trigger; `workflow` is `null` when it can't be read. */
export const checkTrigger = (
  id: string,
  trigger: Trigger,
  workflow: Workflow | null,
): Diagnostic[] => {
  const own =
    trigger.check === undefined ? [] : checkProblems(id, trigger.check);
  if (workflow === null) {
    return [
      ...own,
      error(
        "trigger.workflow",
        `there is no valid workflow "${trigger.run}" in this project`,
        ["triggers", id, "run"],
      ),
    ];
  }
  return [
    ...own,
    ...(workflow.limits?.budgetUsd === undefined
      ? [
          error(
            "trigger.budget",
            `${trigger.run} has no limits.budgetUsd, and a trigger spends with nobody watching: give it a cap`,
            ["triggers", id, "run"],
          ),
        ]
      : []),
    ...inputProblems(id, trigger, workflow),
    ...untrustedWarnings(id, trigger, workflow),
  ];
};
