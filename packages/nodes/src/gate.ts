/**
 * @file The `human.gate` node type: asks the human the rendered question, with
 *   its document if it has one, both in readable text (no raw JSON), outputs
 *   their choice with the note they gave, and answers with the `default` when
 *   the `timeout` passes. The timeout counts only while the run and the gate
 *   are not paused (ADR-041).
 */

import {
  type DecisionChoice,
  endedWith,
  endFor,
  heldTimeout,
  type NodeExecutor,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import { type DecisionOption, timeoutMs } from "@krapht/ork-schema";

/** A promise that never settles: the losing side of a race. */
const NEVER = new Promise<never>(() => {
  // Never settles.
});

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
 * Asks the human and outputs `choice`, `answeredBy` and `note` (empty when they
 * said nothing). With `timeout`, the `default` answers when no one has.
 */
export const gateExecutor: NodeExecutor = async context => {
  const { node } = context;
  if (node.type !== "human.gate") {
    return { ok: false, output: {}, error: `${context.id} is not a gate` };
  }
  const scope = runScope(context.inputs, context.outputs, context.runId);
  const render = (text: string): string => {
    const template = parseTemplate(text);
    return template.ok
      ? renderTemplate(template.parts, scope, { readable: true })
      : text;
  };
  const question = render(node.question);
  const document = render(node.document ?? "");
  const options = node.options.map(o => choiceOf(o));
  const withdraw = new AbortController();
  context.signal.addEventListener("abort", () => {
    withdraw.abort();
  });

  let note = "";
  const asked: Parameters<typeof context.human.ask>[0] = {
    nodeId: context.id,
    question,
    options,
    // A gate is a person's call: with no terminal it waits for `ork decide`.
    waits: true,
    signal: withdraw.signal,
    onNote: given => {
      note = given;
    },
  };
  if (node.recommended !== undefined) asked.recommended = node.recommended;
  if (document.trim() !== "") asked.document = document;
  const answer = context.human
    .ask(asked)
    .then(choice => ({ choice, answeredBy: "user", note }));

  const ms = timeoutMs(node.timeout);
  // Ends the timer once the gate is answered, so it holds nothing open.
  const answered = new AbortController();
  const expired =
    ms === undefined || node.default === undefined
      ? []
      : [
          heldTimeout(context.hold, ms, answered.signal).then(elapsed => {
            // Answered first: this side of the race is already lost.
            if (!elapsed) return NEVER;
            withdraw.abort();
            return {
              choice: node.default ?? "",
              answeredBy: "timeout",
              note: "",
            };
          }),
        ];
  try {
    const output = await Promise.race([answer, ...expired]);
    if (!options.some(o => o.id === output.choice)) {
      const facts = node.timeout === undefined ? {} : { timeout: node.timeout };
      return endedWith(
        { ok: false, output },
        endFor("timed_out", facts, "no one answered the gate"),
      );
    }
    return { ok: true, output };
  } catch {
    return endedWith(
      { ok: false, output: {} },
      endFor("interrupted", {}, "the gate was withdrawn"),
    );
  } finally {
    answered.abort();
  }
};
