/**
 * @file One look at a source (RFC-011): the check a trigger declares, run by
 *   the same executor a node's call is, with no session. Its result has to be
 *   the list `ork watch` reads. It takes no model turn, however often it runs.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  type ExecuteContext,
  type LookResult,
  placeFiles,
  type ProjectPlace,
} from "@krapht/ork-core";
import { mcpCallExecutor, spawnTool, toolExecutor } from "@krapht/ork-nodes";
import {
  CheckReportSchema,
  isToolNode,
  timeoutMs,
  type TriggerCheck,
  type Workflow,
} from "@krapht/ork-schema";

/** How long a check may take, when it doesn't say. */
export const DEFAULT_CHECK_TIMEOUT = "5m";

const NO_HUMAN: ExecuteContext["human"] = {
  permit: () =>
    Promise.resolve({ allow: false, message: "no one is watching a check" }),
  ask: () => Promise.resolve("no one is watching a check"),
};

/** A tool's result has to be read as JSON; an MCP call's already is. */
const asNode = (check: TriggerCheck): TriggerCheck =>
  isToolNode(check) ? { ...check, output: { format: "json" } } : check;

const resultOf = (json: unknown): LookResult => {
  const report = CheckReportSchema.safeParse(json);
  return report.success
    ? { ok: true, events: report.data.events }
    : {
        ok: false,
        error:
          'the check must report { "events": [{ "key": "...", "inputs": { ... } }] }',
      };
};

export const lookAt = async (options: {
  place: ProjectPlace;
  id: string;
  check: TriggerCheck;
  signal: AbortSignal;
}): Promise<LookResult> => {
  const { place, id, signal } = options;
  const node = asNode(options.check);
  const workflow: Workflow = {
    schemaVersion: 1,
    name: `trigger ${id}`,
    nodes: { check: node },
  };
  const runDir = path.join(placeFiles(place).runs, ".triggers", id);
  mkdirSync(runDir, { recursive: true });
  const executor =
    node.type === "mcp.call" ? mcpCallExecutor() : toolExecutor(spawnTool);
  const limit = AbortSignal.timeout(
    timeoutMs(node.timeout ?? DEFAULT_CHECK_TIMEOUT) ?? 0,
  );
  const result = await executor({
    runId: `trigger-${id}`,
    id: "check",
    node,
    workflow,
    inputs: {},
    outputs: {},
    input: undefined,
    round: 1,
    cwd: place.root,
    runDir,
    workflowDir: place.dir,
    projectRoot: place.root,
    orkDir: place.dir,
    budgetLeftUsd: undefined,
    human: NO_HUMAN,
    emit: () => {
      // A look isn't recorded: there's no run to record it in.
    },
    signal: AbortSignal.any([signal, limit]),
  });
  return result.ok
    ? resultOf(result.output["json"])
    : { ok: false, error: result.error ?? "the check failed" };
};
