/**
 * @file What a Claude node's session is planned with, read from the node's
 *   context.
 */

import path from "node:path";

import type { ExecuteContext, PlanOptions } from "@krapht/ork-core";

/** The plan options every session of a node starts from. */
export const planOptionsOf = (
  context: ExecuteContext,
  inPlace: boolean,
): PlanOptions => {
  const planOptions: PlanOptions = {
    cwd: context.cwd,
    inputs: context.inputs,
    outputs: context.outputs,
    inPlace,
    workflowDir: context.workflowDir,
    projectRoot: context.projectRoot,
    ...(context.orkDir === undefined ? {} : { orkDir: context.orkDir }),
    pluginDir: path.join(context.runDir, "plugins", context.id),
  };
  if (context.checkout !== undefined) planOptions.checkout = context.checkout;
  if (context.brief !== undefined) planOptions.brief = context.brief;
  if (context.template !== undefined) planOptions.template = context.template;
  if (context.item !== undefined) planOptions.item = context.item;
  if (context.ownership !== undefined) {
    planOptions.ownership = context.ownership;
  }
  if (context.mailbox !== undefined) planOptions.mailbox = context.mailbox;
  if (context.claims !== undefined) planOptions.claims = context.claims;
  return planOptions;
};
