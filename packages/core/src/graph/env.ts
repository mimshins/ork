/**
 * @file Checks on a tool node's `env:`: names Ork keeps for itself are refused,
 *   a literal that looks like a secret is pointed out before it reaches git,
 *   and so is a template under a name that changes which code runs.
 */

import { type Diagnostic, isToolNode, type Workflow } from "@krapht/ork-schema";

import { error, warning } from "./diagnostics.ts";

const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD/iu;

/** Setting these from a run's output could change which code runs. */
const CODE_NAME =
  /^(?:PATH|NODE_OPTIONS|NODE_PATH|PYTHONPATH|LD_\w+|DYLD_\w+)$/u;

/** Whether a template reads more than the user's own variables. */
const readsRunData = (value: string): boolean =>
  /\{\{\s*(?:inputs|nodes)\b/u.test(value);

export const checkToolEnv = (workflow: Workflow): Diagnostic[] =>
  Object.entries(workflow.nodes).flatMap(([id, node]) =>
    isToolNode(node)
      ? Object.entries(node.env ?? {}).flatMap(([name, value]) => {
          const path = ["nodes", id, "env", name];
          if (name.startsWith("ORK_")) {
            return [
              error("env.reserved", `${name}: Ork sets ORK_* itself`, path),
            ];
          }
          if (SECRET_NAME.test(name) && value !== "" && !value.includes("{{")) {
            return [
              warning(
                "env.literal",
                `${name} looks like a secret, and this file goes to git; use {{env.${name}}}`,
                path,
              ),
            ];
          }
          return CODE_NAME.test(name) && readsRunData(value)
            ? [
                warning(
                  "env.code",
                  `${name} changes which code runs, and here a run's data sets it`,
                  path,
                ),
              ]
            : [];
        })
      : [],
  );
