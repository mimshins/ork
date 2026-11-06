/**
 * @file The context inspector's routes: what one node's session would load,
 *   planned without writing anything. A run's node is planned from the run's
 *   workflow file as it is now, naming each file behind it that changed after
 *   the run started; a builder's node from the draft, else the file, so an edit
 *   shows at once.
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  explainWorkflowText,
  type ProjectRecord,
  type TextExplainResult,
} from "@krapht/ork-core";

import { readText } from "./builder-files.ts";
import { fileOf } from "./builder-view.ts";
import { notFound, problemWith } from "./builder.ts";
import { projectOf, runOf, type ServerContext } from "./context.ts";
import type { NodeContextAnswer } from "./contract-context.ts";
import { fail, type Handlers, ok } from "./router.ts";

type ContextRoutes = Pick<Handlers, "runContext" | "builderContext">;

/** Whether `file` was written after `since`, an ISO time. */
const changedAfter = (file: string, since: string): boolean => {
  try {
    return statSync(file).mtimeMs > Date.parse(since);
  } catch {
    return false;
  }
};

/** A file as the user knows it: in the project, under `~`, or whole. */
const shownAs = (file: string, root: string, home: string): string => {
  const inside = (base: string) => {
    const relative = path.relative(base, file);
    return relative.startsWith("..") || path.isAbsolute(relative)
      ? undefined
      : relative;
  };
  const inProject = inside(root);
  if (inProject !== undefined) return inProject;
  const inHome = inside(home);
  return inHome === undefined ? file : `~/${inHome}`;
};

const answerOf = (
  result: TextExplainResult,
  changedSinceStart: string[],
): NodeContextAnswer =>
  result.ok
    ? { planned: true, explanation: result.explanation, changedSinceStart }
    : { planned: false, why: result.error, changedSinceStart };

export const contextRoutes = (context: ServerContext): ContextRoutes => {
  /** Where to plan: in `place`, when the project is registered. */
  const where = (place: ProjectRecord | undefined) => ({
    registered: context.store.projects(),
    ...(context.home === undefined ? {} : { home: context.home }),
    ...(place === undefined ? {} : { place }),
  });
  return {
    runContext: ({ params }) => {
      const found = runOf(context, params.id);
      if (!found.ok) return found.refusal;
      const { file, startedAt, project } = found.run;
      const home = context.home ?? homedir();
      const text = readText(file);
      if (text === undefined) {
        return ok({
          planned: false,
          why: `The run's workflow file \`${file}\` is gone.`,
          changedSinceStart: [shownAs(file, project, home)],
        });
      }
      const result = explainWorkflowText(
        text,
        file,
        params.node,
        where(projectOf(context, project)),
      );
      const read = [file, ...(result.ok ? result.sources : [])];
      return ok(
        answerOf(
          result,
          [...new Set(read)]
            .filter(each => changedAfter(each, startedAt))
            .map(each => shownAs(each, project, home)),
        ),
      );
    },
    builderContext: ({ params }) => {
      const project = projectOf(context, params.id);
      if (project === undefined) {
        return fail(404, `No registered project \`${params.id}\`.`);
      }
      const problem = problemWith(project, params.name);
      if (problem !== undefined) return fail(problem.refused, problem.error);
      const file = fileOf(project, params.name);
      const text =
        context.store.draft(project.id, params.name)?.text ?? readText(file);
      if (text === undefined) {
        const missing = notFound(project, params.name);
        return fail(missing.refused, missing.error);
      }
      return ok(
        answerOf(
          explainWorkflowText(text, file, params.node, where(project)),
          [],
        ),
      );
    },
  };
};
