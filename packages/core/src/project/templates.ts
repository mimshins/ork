/**
 * @file Git name templates (`ork/{run}/{node}`, `{inputs.type}/{inputs.slug}`):
 *   their placeholders, checking them against a workflow's inputs, and
 *   rendering them for one node of a run.
 */

import { TEMPLATE_VARIABLES } from "@krapht/ork-schema";

const PLACEHOLDER = /\{([^{}]*)\}/gu;

/** The names inside `{…}` in a template, in order. */
export const placeholdersOf = (template: string): string[] =>
  [...template.matchAll(PLACEHOLDER)].map(match => match[1] ?? "");

/** Problems with a template's placeholders, given the workflow's inputs. */
export const templateProblems = (
  template: string,
  inputs: readonly string[],
): string[] =>
  placeholdersOf(template).flatMap(name => {
    if ((TEMPLATE_VARIABLES as readonly string[]).includes(name)) return [];
    if (name.startsWith("inputs.")) {
      const input = name.slice("inputs.".length);
      return inputs.includes(input)
        ? []
        : [`{${name}} names no input of this workflow`];
    }
    return [
      `{${name}} is not a placeholder; use ${TEMPLATE_VARIABLES.map(v => `{${v}}`).join(", ")} or {inputs.<name>}`,
    ];
  });

export type TemplateValues = {
  run: string;
  node: string;
  clone: string;
  inputs: Readonly<Record<string, string | number | boolean | undefined>>;
};

/** Fills a template's placeholders; an unset input renders as empty. */
export const renderGitTemplate = (
  template: string,
  values: TemplateValues,
): string =>
  template.replaceAll(PLACEHOLDER, (_whole, name: string) => {
    if (name === "run") return values.run;
    if (name === "node") return values.node;
    if (name === "clone") return values.clone;
    if (name.startsWith("inputs.")) {
      const value = values.inputs[name.slice("inputs.".length)];
      return value === undefined ? "" : String(value);
    }
    return `{${name}}`;
  });
