/**
 * @file The `workflow.call` node type (RFC-004): renders what the node asks for
 *   and hands it to the run's call port, which starts the workflow as its own
 *   run and waits as the node says.
 */

import {
  type NodeExecutor,
  type NodeResult,
  NOT_STARTED,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";

/**
 * A call a limit stopped is cut off, as a session is: the called run ended
 * `quota_exhausted`, or was refused at its start, which the caller's own limits
 * can't see when its project has its own.
 */
const limitedCall = (result: NodeResult): NodeResult => {
  if (result.ok) return result;
  const refused = (result.error ?? "").includes(NOT_STARTED);
  return refused || result.output["runStatus"] === "quota_exhausted"
    ? { ...result, limited: result.error ?? "the called run reached a limit" }
    : result;
};

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
  const scope = runScope(
    context.inputs,
    context.outputs,
    context.runId,
    context.item,
  );
  const render = (text: string): string => {
    const template = parseTemplate(text);
    return template.ok ? renderTemplate(template.parts, scope) : text;
  };
  const called = calls.invoke(
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
      // The run's own budget: the called run reads the quotas for itself.
      budgetLeftUsd: context.budgetLeftNow?.() ?? context.budgetLeftUsd,
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
  return called.then(limitedCall);
};
