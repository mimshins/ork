/**
 * @file The tools `ork mcp` gives Claude Code beyond reading (RFC-012):
 *   `check`, which checks a draft or a file as `ork validate` does, walk and
 *   all, and `start_run`, which starts a run in the background as `ork run
 *   --detach` does. Neither answers a decision; starting is the one that
 *   spends, and Claude Code asks the person before each.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  checkWorkflowText,
  placeFiles,
  walkChecks,
  walkSummary,
  type ProjectRecord,
  workflowDirOf,
} from "@krapht/ork-core";
import { z } from "zod";

import { projectOf, type ServerContext } from "./context.ts";
import { answer, fromReply, type McpAnswer, refused } from "./mcp-answers.ts";
import { tool, type McpTool } from "./mcp-tool.ts";
import { workflowFile, writeRoutes } from "./write-routes.ts";

/** How many of a walk's endings `check` lists when asked for them. */
const MOST_ENDINGS = 20;

const project = z.string().min(1).describe("A registered project's id or root");

/** The text to check, and the file whose folder its paths resolve from. */
const textOf = (
  context: ServerContext,
  key: string,
  args: { workflow?: string | undefined; text?: string | undefined },
):
  | { ok: true; text: string; file: string; place: ProjectRecord }
  | { ok: false; answer: McpAnswer } => {
  const place = projectOf(context, key);
  if (place === undefined) {
    return { ok: false, answer: refused(`No registered project \`${key}\`.`) };
  }
  if ((args.workflow === undefined) === (args.text === undefined)) {
    return {
      ok: false,
      answer: refused("Give either `workflow` (a name or path) or `text`."),
    };
  }
  if (args.text !== undefined) {
    const file = path.join(placeFiles(place).workflows, "draft.ork.yaml");
    return { ok: true, text: args.text, file, place };
  }
  const file = workflowFile(place, args.workflow ?? "");
  return file === null
    ? {
        ok: false,
        answer: refused(
          `No workflow \`${args.workflow ?? ""}\` in \`${place.id}\`'s workflows or inside its root.`,
        ),
      }
    : { ok: true, text: readFileSync(file, "utf8"), file, place };
};

const checkTool = (context: ServerContext): McpTool =>
  tool(
    "check",
    "Checks a workflow as `ork validate` does: a draft's `text`, or a `workflow` by name or path. It gives each problem with its line, then walks every way through without running anything. Ask for `paths` to see how a run can end.",
    {
      project,
      workflow: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      paths: z.boolean().optional(),
    },
    async args => {
      const found = textOf(context, args.project, args);
      if (!found.ok) return found.answer;
      const { diagnostics, walk } = await walkChecks(
        checkWorkflowText(found.text, {
          place: found.place,
          workflowDir: workflowDirOf(found.place, found.file),
          registered: context.store.projects(),
          ...(context.home === undefined ? {} : { home: context.home }),
        }),
      );
      const count = (severity: string) =>
        diagnostics.filter(each => each.severity === severity).length;
      return answer({
        errors: count("error"),
        warnings: count("warning"),
        diagnostics: diagnostics.map(
          ({ severity, code, message, line, column }) =>
            line === undefined
              ? { severity, code, message }
              : { severity, code, message, line, column },
        ),
        walk: walk === undefined ? null : walkSummary(walk),
        ...(args.paths === true && walk !== undefined
          ? { endings: walk.endings.slice(0, MOST_ENDINGS) }
          : {}),
      });
    },
  );

const startTool = (context: ServerContext): McpTool => {
  const { start } = writeRoutes(context);
  return tool(
    "start_run",
    "Starts a workflow in the background, as `ork run --detach` does, and gives its run id. It spends money, and its questions wait on a person, who answers in `ork ui` or with `ork decide`.",
    {
      project,
      workflow: z.string().min(1).describe("A workflow's name, or a path"),
      inputs: z.record(z.string(), z.string()).optional(),
    },
    args =>
      fromReply(
        start({ params: {}, query: undefined, body: args }),
        started => ({
          ...started,
          next: "Follow it with `run` and `run_events`. A decision it opens waits on a person.",
        }),
      ),
    { readOnly: false },
  );
};

/** `check`, and `start_run` where starting is allowed. */
export const actingTools = (
  context: ServerContext,
  options: { start: boolean },
): McpTool[] => [
  checkTool(context),
  ...(options.start ? [startTool(context)] : []),
];
