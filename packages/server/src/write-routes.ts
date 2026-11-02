/**
 * @file The API's write routes (specs/server.md#api): answer a decision, stop a
 *   run, message a live run's node, and start or resume a run in the
 *   background. Each does what its CLI command does (`ork decide --id`, `stop`,
 *   `chat -m`, `run --detach`, `resume --detach`), through the same functions
 *   in core: rows in the store, a wake on the run's socket, or a detached
 *   process. The server itself runs nothing.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  answerDecision,
  detachResume,
  detachRun,
  inside,
  liveStatus,
  newRunId,
  nodeSession,
  placeFiles,
  type ProjectRecord,
  requestStop,
  resumable,
  runDirOf,
  tellLiveRun,
} from "@krapht/ork-core";

import { projectOf, runOf, type ServerContext } from "./context.ts";
import { accepted, fail, type Handlers, ok } from "./router.ts";

type WriteRoutes = Pick<
  Handlers,
  "answer" | "stop" | "message" | "start" | "resume"
>;

type RunFlags = {
  inputs?: Record<string, string> | undefined;
  driver?: "sdk" | "cli" | undefined;
  inPlace?: boolean | undefined;
  allowDirty?: boolean | undefined;
};

/** The `ork run` / `ork resume` flags a request's options stand for. */
export const flagsOf = (options: RunFlags): string[] => [
  ...Object.entries(options.inputs ?? {}).flatMap(([name, value]) => [
    "--input",
    `${name}=${value}`,
  ]),
  ...(options.driver === undefined ? [] : ["--driver", options.driver]),
  ...(options.inPlace === undefined
    ? []
    : [options.inPlace ? "--in-place" : "--no-in-place"]),
  ...(options.allowDirty === true ? ["--allow-dirty"] : []),
];

const WORKFLOW_SUFFIX = ".ork.yaml";

/**
 * A workflow file of `project`: a name in its workflows folder, or a path
 * inside the project's root or its Ork folder.
 */
export const workflowFile = (
  project: ProjectRecord,
  workflow: string,
): string | null => {
  const workflows = placeFiles(project).workflows;
  const candidates = [
    path.join(workflows, `${workflow}${WORKFLOW_SUFFIX}`),
    path.resolve(project.root, workflow),
  ];
  return (
    candidates.find(
      file =>
        (inside(project.root, file) || inside(project.dir, file)) &&
        existsSync(file) &&
        statSync(file).isFile(),
    ) ?? null
  );
};

const answerStatus = (error: string): 400 | 404 | 409 => {
  if (error.startsWith("No decision")) return 404;
  return error.includes("is not an option") ? 400 : 409;
};

export const writeRoutes = (context: ServerContext): WriteRoutes => {
  const script = context.script === undefined ? {} : { script: context.script };
  return {
    answer: async ({ params, body }) => {
      const answered = await answerDecision(
        context.store,
        params.id,
        body.choose,
        context.home,
        "ui",
      );
      return answered.ok
        ? ok({ decision: params.id, answer: body.choose })
        : fail(answerStatus(answered.error), answered.error);
    },

    stop: async ({ params }) => {
      const found = runOf(context, params.id);
      if (!found.ok) return found.refusal;
      const asked = await requestStop(context.store, found.run, context.home);
      return asked.ok
        ? accepted({ runId: found.run.id })
        : fail(409, asked.error);
    },

    message: async ({ params, body }) => {
      const found = runOf(context, params.id);
      if (!found.ok) return found.refusal;
      const { run } = found;
      const { session } = nodeSession(
        context.store.events(run.id, 0),
        body.node,
      );
      if (!session.known) {
        return fail(404, `${body.node} is not a node of run ${run.id}.`);
      }
      if (!session.chattable) {
        return fail(
          400,
          `${body.node} is not a leader or worker; only they have sessions to talk to.`,
        );
      }
      if (liveStatus(run) !== "running") {
        return fail(
          409,
          `Run ${run.id} is not running; to talk to a finished run's node, use ork chat ${run.id} ${body.node}.`,
        );
      }
      await tellLiveRun(context.store, run, body.node, body.body, context.home);
      return accepted({ runId: run.id });
    },

    start: async ({ body }) => {
      const request = body;
      const project = projectOf(context, request.project);
      if (project === undefined) {
        return fail(
          404,
          `No registered project "${request.project}"; register it with ork init or ork register.`,
        );
      }
      const file = workflowFile(project, request.workflow);
      if (file === null) {
        return fail(
          404,
          `No workflow "${request.workflow}" in ${project.id}'s workflows or inside its root.`,
        );
      }
      const runId = newRunId(context.store);
      const detached = await detachRun({
        store: context.store,
        runId,
        args: ["run", file, ...flagsOf(request), "--run-id", runId],
        cwd: project.root,
        runDir: runDirOf(project, runId),
        ...script,
      });
      return detached.ok
        ? accepted({ runId })
        : fail(400, detached.error || "The run did not start.");
    },

    resume: async ({ params, body }) => {
      const found = runOf(context, params.id);
      if (!found.ok) return found.refusal;
      const ready = resumable(context.store, found.run, {
        ...(body.inPlace === undefined ? {} : { inPlace: body.inPlace }),
        ...(body.driver === undefined ? {} : { driver: body.driver }),
      });
      if (!ready.ok) return fail(409, ready.error);
      const detached = await detachResume(
        context.store,
        found.run,
        flagsOf(body),
        context.script,
      );
      return detached.ok
        ? accepted({ runId: found.run.id })
        : fail(400, detached.error || "The run did not resume.");
    },
  };
};
