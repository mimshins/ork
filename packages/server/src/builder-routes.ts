/**
 * @file The workflow builder's routes (RFC-008, specs/server.md#api). Each
 *   finds the project, then does its work in `builder.ts`, and a refusal has
 *   the words the user will see.
 */

import { homedir } from "node:os";
import path from "node:path";

import { loadAgents, type ProjectRecord, skillsIn } from "@krapht/ork-core";
import { renderJsonSchema } from "@krapht/ork-schema";

import {
  builderView,
  createDraft,
  discardDraft,
  editDraft,
  type Refused,
  restoreDraft,
  saveDraft,
} from "./builder.ts";
import { projectOf, type ServerContext } from "./context.ts";
import { fail, type Handlers, ok, type Reply } from "./router.ts";

type BuilderRoutes = Pick<
  Handlers,
  | "builderSchema"
  | "builderCatalog"
  | "builderDrafts"
  | "builderView"
  | "builderCreate"
  | "builderEdit"
  | "builderRestore"
  | "builderDiscard"
  | "builderSave"
>;

const isRefused = (answer: object): answer is Refused => "refused" in answer;

const replyOf = <T extends object>(answer: T | Refused): Reply<T> =>
  isRefused(answer) ? fail(answer.refused, answer.error) : ok(answer);

export const builderRoutes = (context: ServerContext): BuilderRoutes => {
  /** The answer for a registered project; a 404 for any other. */
  const inProject = <T extends object>(
    id: string,
    work: (project: ProjectRecord) => T | Refused,
  ): Reply<T> => {
    const project = projectOf(context, id);
    return project === undefined
      ? fail(404, `No registered project \`${id}\`.`)
      : replyOf(work(project));
  };
  /** The same, for work the server walks a workflow for. */
  const walkedInProject = async <T extends object>(
    id: string,
    work: (project: ProjectRecord) => Promise<T | Refused>,
  ): Promise<Reply<T>> => {
    const project = projectOf(context, id);
    return project === undefined
      ? fail(404, `No registered project \`${id}\`.`)
      : replyOf(await work(project));
  };
  return {
    builderSchema: () => ok(JSON.parse(renderJsonSchema()) as unknown),
    builderCatalog: ({ params }) =>
      inProject(params.id, project => {
        const home = context.home ?? homedir();
        return {
          agents: loadAgents({
            projectRoot: project.root,
            orkDir: project.dir,
            home,
          }).agents.map(({ name, source, agent }) => ({
            name,
            description: agent.description ?? "",
            source,
          })),
          skills: [
            ...skillsIn(path.join(home, ".ork", "skills"), "user"),
            ...skillsIn(
              path.join(project.root, ".claude", "skills"),
              "project",
            ),
          ].map(({ name, layer }) => ({ name, layer })),
        };
      }),
    builderDrafts: ({ params }) =>
      inProject(params.id, project => {
        const names = context.store
          .drafts(project.id)
          .map(({ workflow }) => workflow);
        return names;
      }),
    builderView: ({ params }) =>
      walkedInProject(params.id, project =>
        builderView(context, project, params.name),
      ),
    builderCreate: ({ params, body }) =>
      walkedInProject(params.id, project =>
        createDraft(context, project, body.name),
      ),
    builderEdit: ({ params, body }) =>
      walkedInProject(params.id, project =>
        editDraft(context, project, params.name, body.edits),
      ),
    builderRestore: ({ params, body }) =>
      walkedInProject(params.id, project =>
        restoreDraft(context, project, params.name, body.text, body.baseHash),
      ),
    builderDiscard: ({ params }) =>
      walkedInProject(params.id, project =>
        discardDraft(context, project, params.name),
      ),
    builderSave: ({ params, body }) =>
      inProject(params.id, project =>
        saveDraft(context, project, params.name, body.force === true),
      ),
  };
};
