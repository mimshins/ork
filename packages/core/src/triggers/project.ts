/**
 * @file Reading what each registered project declares (RFC-011): its
 *   `triggers.yaml`, each trigger's workflow, and the hash a person accepts.
 *   Read fresh each time, so a file changed by a pull turns its trigger off
 *   rather than running as it was.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  type Diagnostic,
  parseTriggers,
  type Trigger,
  type TriggerCheck,
  type Workflow,
} from "@krapht/ork-schema";

import { inside } from "../context/files.ts";
import { error as errorAt } from "../graph/diagnostics.ts";
import { checkWorkflowText } from "../project/check.ts";
import {
  placeFiles,
  type ProjectPlace,
  type ProjectRecord,
  workflowDirOf,
} from "../project/place.ts";
import { checkTrigger } from "./check.ts";
import { triggerHash, workflowTextHash } from "./trust.ts";
import type { DeclaredTrigger } from "./watcher.ts";

/** A file's text; `undefined` only when it isn't there. Anything else throws. */
const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const isFile = (file: string): boolean =>
  statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/**
 * What a check runs beyond its own words, for what a person accepts: the
 * `.mcp.json` its server comes from, or the project's files its command names.
 */
const checkReads = (
  root: string,
  check: TriggerCheck | undefined,
): string[] => {
  if (check === undefined) return [];
  if (check.type === "mcp.call") {
    return [readText(path.join(root, ".mcp.json")) ?? ""];
  }
  const from = path.resolve(root, check.cwd ?? ".");
  return [check.command, check.interpreter]
    .join(" ")
    .split(/\s+/u)
    .flatMap(word => {
      const file = path.resolve(from, word);
      return word !== "" && inside(root, file) && isFile(file)
        ? [`${word}\0${readFileSync(file, "utf8")}`]
        : [];
    });
};

/** Where a project's workflow of this name is. */
export const workflowFileOf = (place: ProjectPlace, name: string): string =>
  path.join(placeFiles(place).workflows, `${name}.ork.yaml`);

export type ProjectTrigger = {
  place: ProjectPlace;
  id: string;
  trigger: Trigger;
  hash: string;
  workflowFile: string;
  /** What a run has to find in that file, or it refuses. */
  workflowHash: string;
  workflow: Workflow | null;
  diagnostics: Diagnostic[];
};

export type ProjectTriggers = {
  file: string;
  /** Whether it's there at all. */
  present: boolean;
  /** What's wrong with the file as a whole, when it doesn't parse. */
  diagnostics: Diagnostic[];
  triggers: ProjectTrigger[];
};

const readTriggers = (
  file: string,
  place: ProjectPlace,
  home: string | undefined,
  registered: readonly ProjectPlace[],
): ProjectTriggers => {
  const text = readText(file);
  if (text === undefined) {
    return { file, present: false, diagnostics: [], triggers: [] };
  }
  const parsed = parseTriggers(text);
  if (!parsed.ok) {
    return {
      file,
      present: true,
      diagnostics: parsed.diagnostics,
      triggers: [],
    };
  }
  const located = (diagnostic: Diagnostic): Diagnostic => {
    const position = parsed.locate(diagnostic.path);
    return position === undefined ? diagnostic : { ...diagnostic, ...position };
  };
  const triggers = Object.entries(parsed.file.triggers).map(([id, trigger]) => {
    const workflowFile = workflowFileOf(place, trigger.run);
    const workflowText = readText(workflowFile);
    const { workflow } =
      workflowText === undefined
        ? { workflow: null }
        : checkWorkflowText(workflowText, {
            place,
            workflowDir: workflowDirOf(place, workflowFile),
            registered,
            ...(home === undefined ? {} : { home }),
          });
    return {
      place,
      id,
      trigger,
      hash: triggerHash(
        trigger,
        workflowText,
        place.root,
        checkReads(place.root, trigger.check),
      ),
      workflowFile,
      workflowHash: workflowTextHash(workflowText ?? ""),
      workflow,
      diagnostics: checkTrigger(id, trigger, workflow).map(item =>
        located(item),
      ),
    };
  });
  return { file, present: true, diagnostics: [], triggers };
};

/**
 * A project's triggers, each checked against the workflow it starts. A file
 * that can't be read says so here: one project mustn't end the watcher for the
 * rest.
 */
export const readProjectTriggers = (
  place: ProjectPlace,
  home?: string,
  registered: readonly ProjectPlace[] = [],
): ProjectTriggers => {
  const file = placeFiles(place).triggers;
  try {
    return readTriggers(file, place, home, registered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      file,
      present: true,
      diagnostics: [errorAt("trigger.read", message, [])],
      triggers: [],
    };
  }
};

const hasError = ({ diagnostics }: ProjectTrigger): boolean =>
  diagnostics.some(({ severity }) => severity === "error");

/**
 * What can run now, in every project. One with an error can't: its workflow may
 * have lost its budget since it was accepted.
 */
export const declaredTriggers = (
  projects: readonly ProjectRecord[],
  home?: string,
): (DeclaredTrigger &
  Pick<ProjectTrigger, "workflowFile" | "workflowHash"> & {
    place: ProjectPlace;
    workflow: Workflow;
  })[] =>
  projects.flatMap(place =>
    readProjectTriggers(place, home, projects).triggers.flatMap(item =>
      hasError(item) || item.workflow === null
        ? []
        : [
            {
              project: place.id,
              id: item.id,
              trigger: item.trigger,
              hash: item.hash,
              workflowFile: item.workflowFile,
              workflowHash: item.workflowHash,
              place,
              workflow: item.workflow,
            },
          ],
    ),
  );
