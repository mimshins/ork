/**
 * @file What one node of a workflow's text would load, for a reader that has
 *   the text rather than a path to load (the UI's context inspector: a run's
 *   file as it is now, or the builder's draft). It checks the text as `ork
 *   validate` does, without the walk, then plans the node in place, and says
 *   which files and folders the plan read, so a reader can tell which changed
 *   since: a folder's time changes when a file is added to it or taken out.
 */

import { homedir } from "node:os";
import path from "node:path";

import {
  AGENT_FILE_SUFFIX,
  AGENT_SIDECAR_SUFFIX,
  diagnosticText,
} from "@krapht/ork-schema";

import { SKILL_FILE } from "../context/skills.ts";
import { type Explanation, explainSession } from "../run/explain.ts";
import { checkWorkflowText } from "./check.ts";
import {
  placeFiles,
  placeFor,
  type ProjectPlace,
  workflowDirOf,
} from "./place.ts";

export type TextExplainResult =
  | {
      ok: true;
      explanation: Explanation;
      /**
       * Every file behind the stack, absolute: the agent and its settings, the
       * project's rules, instructions, skills and context, and the folders
       * whose skills and context load without being named.
       */
      sources: string[];
    }
  | { ok: false; error: string };

/** A piece's shown path (project-relative, or `~/…`) as a file. */
const fileOf = (shown: string, root: string, home: string): string =>
  shown.startsWith("~/")
    ? path.join(home, shown.slice(2))
    : path.resolve(root, shown);

/** An agent's file and its settings beside it, if it's in a file. */
const agentFiles = (e: Explanation, root: string, home: string): string[] => {
  if (e.agent === undefined || !["user", "project"].includes(e.agent.source)) {
    return [];
  }
  const file = fileOf(e.agent.where, root, home);
  return file.endsWith(AGENT_FILE_SUFFIX)
    ? [
        file,
        `${file.slice(0, -AGENT_FILE_SUFFIX.length)}${AGENT_SIDECAR_SUFFIX}`,
      ]
    : [file];
};

/** The files and folders an explanation's pieces were read from. */
const sourcesOf = (
  e: Explanation,
  place: ProjectPlace,
  home: string,
): string[] => {
  const { root } = place;
  return [
    ...agentFiles(e, root, home),
    placeFiles(place).rules,
    ...(e.instructionFiles ?? []).map(f => path.join(root, f.name)),
    ...e.skills
      .filter(s => s.source !== "built-in")
      .map(s => path.join(fileOf(s.source, root, home), SKILL_FILE)),
    ...e.files.map(f => fileOf(f.name, root, home)),
    path.join(home, ".ork", "context"),
    path.join(home, ".ork", "skills"),
    path.join(root, ".claude", "skills"),
  ];
};

/**
 * Explains `nodeId` in `text`, read as the workflow file `file`, with its
 * pieces' words. `place` is the project it belongs to when the caller knows it
 * (the builder's project, a run's), else found from the file as `ork validate`
 * does. A workflow with errors is refused with the first of them.
 */
export const explainWorkflowText = (
  text: string,
  file: string,
  nodeId: string,
  where: {
    registered: readonly ProjectPlace[];
    home?: string;
    place?: ProjectPlace;
  },
): TextExplainResult => {
  const place = where.place ?? placeFor(path.dirname(file), where.registered);
  const workflowDir = workflowDirOf(place, file);
  const { workflow, graph, diagnostics } = checkWorkflowText(text, {
    place,
    workflowDir,
    registered: where.registered,
    home: where.home,
  });
  if (workflow === null) {
    const first = diagnostics.find(d => d.severity === "error");
    return {
      ok: false,
      error: `The workflow has errors, so it can't be planned${first === undefined ? "." : `: ${diagnosticText(first)}`}`,
    };
  }
  const result = explainSession(
    workflow,
    graph,
    nodeId,
    {
      root: place.root,
      orkDir: place.dir,
      workflowDir,
      ...(where.home === undefined ? {} : { home: where.home }),
    },
    { texts: true },
  );
  return result.ok
    ? {
        ...result,
        sources: sourcesOf(result.explanation, place, where.home ?? homedir()),
      }
    : result;
};
