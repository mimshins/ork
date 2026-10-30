/**
 * @file The `human.gate` node type: asks the human the rendered question, and
 *   answers with the `default` when the `timeout` passes.
 */

import {
  type DecisionChoice,
  type NodeExecutor,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import type { DecisionOption } from "@krapht/ork-schema";

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** `30s`, `15m`, `2h` in milliseconds; `undefined` without a timeout. */
export const timeoutMs = (timeout: string | undefined): number | undefined => {
  const match = /^(\d+)([smh])$/u.exec(timeout ?? "");
  if (match === null) return undefined;
  const [, amount = "0", unit = "s"] = match;
  return Number(amount) * (UNITS[unit] ?? 1000);
};

const choiceOf = (option: DecisionOption): DecisionChoice => {
  if (typeof option === "string") return { id: option };
  const choice: DecisionChoice = { id: option.id };
  if (option.label !== undefined) choice.label = option.label;
  if (option.description !== undefined) {
    choice.description = option.description;
  }
  return choice;
};

/**
 * Asks the human and outputs `choice` and `answeredBy`. With `timeout`, the
 * `default` answers when no one has.
 */
export const gateExecutor: NodeExecutor = async context => {
  const { node } = context;
  if (node.type !== "human.gate") {
    return { ok: false, output: {}, error: `${context.id} is not a gate` };
  }
  const template = parseTemplate(node.question);
  const question = template.ok
    ? renderTemplate(
        template.parts,
        runScope(context.inputs, context.outputs, context.runId),
      )
    : node.question;
  const options = node.options.map(o => choiceOf(o));
  const withdraw = new AbortController();
  context.signal.addEventListener("abort", () => {
    withdraw.abort();
  });

  const asked: Parameters<typeof context.human.ask>[0] = {
    nodeId: context.id,
    question,
    options,
    signal: withdraw.signal,
  };
  if (node.recommended !== undefined) asked.recommended = node.recommended;
  const answer = context.human
    .ask(asked)
    .then(choice => ({ choice, answeredBy: "user" }));

  const ms = timeoutMs(node.timeout);
  let timer: NodeJS.Timeout | undefined;
  const expired =
    ms === undefined || node.default === undefined
      ? []
      : [
          new Promise<{ choice: string; answeredBy: string }>(resolve => {
            timer = setTimeout(() => {
              withdraw.abort();
              resolve({ choice: node.default ?? "", answeredBy: "timeout" });
            }, ms);
          }),
        ];
  try {
    const output = await Promise.race([answer, ...expired]);
    if (!options.some(o => o.id === output.choice)) {
      return {
        ok: false,
        output,
        error: "no one answered the gate",
      };
    }
    return { ok: true, output };
  } catch {
    return { ok: false, output: {}, error: "the gate was withdrawn" };
  } finally {
    clearTimeout(timer);
  }
};
