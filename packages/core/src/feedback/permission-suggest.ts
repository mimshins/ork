/**
 * @file Which shell rules to propose for a project's `permissions.allow`
 *   (`permission.suggest`, RFC-028 part 4): a rule a person allowed (once, for
 *   a node or for a run) often enough across the project's runs that the
 *   project's allow rules do not cover yet. A decision's rules are those its
 *   context's commands give (`ruleFor`) that its options named, so a prompt
 *   that offered none counts for nothing. A rule once answered "always" is
 *   already in the file, or was meant to be, so it is never proposed.
 */

import { allowsRule } from "../run/permission-verdict.ts";
import { readShellLine } from "../run/shell-line.ts";
import { ruleFor } from "../run/shell-rule.ts";
import type { DecisionRecord } from "../store/types.ts";
import { SUGGEST_MIN_ALLOWS, SUGGEST_MIN_RUNS } from "./suggest-thresholds.ts";

/** A rule as an option's description names it. */
const RULE = /Bash\([^()]*\)/gu;

/** Answers that allowed a call without adding its rules to the file. */
export const COUNTED_ALLOWS: ReadonlySet<string> = new Set([
  "allow",
  "allow-node",
  "allow-run",
]);

/** The rules the answered permission decision `decision` offered past its call. */
export const offeredRules = (decision: DecisionRecord): string[] => {
  const named = new Set(
    decision.options.flatMap(option => option.description?.match(RULE) ?? []),
  );
  const commands = readShellLine(decision.context ?? "")?.commands ?? [];
  return [
    ...new Set(
      commands.flatMap(command => {
        const rule = ruleFor(command);
        return rule !== null && named.has(rule) ? [rule] : [];
      }),
    ),
  ];
};

/**
 * The rules to propose, from the project's decisions (every run's): allowed at
 * least `SUGGEST_MIN_ALLOWS` times across `SUGGEST_MIN_RUNS` runs, never
 * answered "always", and not covered by `allow`.
 */
export const suggestedRules = (
  decisions: readonly DecisionRecord[],
  allow: readonly string[],
): string[] => {
  const runs = new Map<string, string[]>();
  const always = new Set<string>();
  for (const decision of decisions) {
    if (decision.kind !== "permission" || decision.status !== "answered") {
      continue;
    }
    const answer = decision.answer ?? "";
    for (const rule of offeredRules(decision)) {
      if (answer === "allow-always") always.add(rule);
      if (COUNTED_ALLOWS.has(answer)) {
        runs.set(rule, [...(runs.get(rule) ?? []), decision.runId]);
      }
    }
  }
  return [...runs].flatMap(([rule, from]) =>
    from.length >= SUGGEST_MIN_ALLOWS &&
    new Set(from).size >= SUGGEST_MIN_RUNS &&
    !always.has(rule) &&
    !allowsRule(allow, rule)
      ? [rule]
      : [],
  );
};
