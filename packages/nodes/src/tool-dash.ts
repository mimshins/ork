/**
 * @file The leading-`-` guard on a tool node's command: an argument that starts
 *   with a template reading `nodes.*.output` and renders to a leading `-` would
 *   read as an option of the program, so it is refused unless a `--` comes
 *   before it. A literal `-x` and `--flag={{…}}` are not affected. Also how a
 *   tool node renders one argument (or its `cwd`) with that guard.
 */

import {
  type ExecuteContext,
  parseTemplate,
  renderTemplate,
  runScope,
  type TemplatePart,
} from "@krapht/ork-core";

/** The error for a rendered argument that reads as an option, or `undefined`. */
export const leadingDashError = (
  parts: readonly TemplatePart[],
  value: string,
): string | undefined => {
  const first = parts[0];
  if (
    !value.startsWith("-") ||
    typeof first !== "object" ||
    first.expr.kind !== "path" ||
    first.expr.segments[0] !== "nodes" ||
    first.expr.segments[2] !== "output"
  ) {
    return undefined;
  }
  return `argument from nodes.${String(first.expr.segments[1])}.output starts with \`-\`; put \`--\` before it in the command`;
};

/** One templated argument, rendered; `guardDash` refuses a leading `-`. */
export const renderArg = (
  text: string,
  context: ExecuteContext,
  guardDash = false,
): { ok: true; value: string } | { ok: false; error: string } => {
  const template = parseTemplate(text);
  if (!template.ok) return { ok: false, error: template.message };
  const value = renderTemplate(
    template.parts,
    runScope(context.inputs, context.outputs, context.runId, context.item),
  );
  // A node's output can start with `-` and then reads as an option.
  const error = guardDash ? leadingDashError(template.parts, value) : undefined;
  return error === undefined ? { ok: true, value } : { ok: false, error };
};
