/**
 * @file The `workflow.call` node type (RFC-004): renders what the node asks for
 *   and hands it to the run's call port, which starts the workflow as its own
 *   run and waits as the node says.
 */

import {
  type NodeExecutor,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";

export const callExecutor: NodeExecutor = context => {
  const { node, calls } = context;
  if (node.type !== "workflow.call") {
    return Promise.resolve({
      ok: false,
      output: {},
      error: `${context.id} is not a call`,
    });
  }
  if (calls === undefined) {
    return Promise.resolve({
      ok: false,
      output: { status: "fail" },
      error: "This run cannot call workflows.",
    });
  }
  const scope = runScope(context.inputs, context.outputs, context.runId);
  const render = (text: string): string => {
    const template = parseTemplate(text);
    return template.ok ? renderTemplate(template.parts, scope) : text;
  };
  return calls.invoke(
    {
      callId: context.id,
      workflow: render(node.workflow),
      project: node.project === undefined ? undefined : render(node.project),
      node: node.node,
      inputs: Object.fromEntries(
        Object.entries(node.inputs ?? {}).map(([name, value]) => [
          name,
          render(value),
        ]),
      ),
      wait: node.wait ?? (node.node === undefined ? "run" : "node"),
      ref: node.ref === undefined ? undefined : render(node.ref),
      maxMessages: node.maxMessages,
      input: context.input,
      budgetLeftUsd: context.budgetLeftUsd,
      channels: (context.workflow.messages ?? []).flatMap(({ between }) => {
        const [a, b] = between;
        if (a === context.id) return [b];
        return b === context.id ? [a] : [];
      }),
      linked: address => {
        context.mailbox?.alias(address);
      },
    },
    context.signal,
  );
};
