/**
 * @file Context files for the context compiler: the user's `~/.ork/context`,
 *   the files a workflow or node names, the workflow's accepted lessons, and
 *   the project root that every reference must stay inside.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Diagnostic, DiagnosticPath } from "@krapht/ork-schema";

import { error } from "../graph/diagnostics.ts";

export type ContextLayer = "user" | "workflow" | "node";

export type ContextFile = {
  layer: ContextLayer;
  /** Repository-relative, or `~/.ork/…` for the user layer. */
  name: string;
  text: string;
};

/**
 * The project a folder is in: the nearest folder up from it with a `.git` (a
 * clone or a worktree), else the folder itself.
 */
export const projectRootOf = (dir: string): string => {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    if (existsSync(path.join(current, ".git"))) return current;
    if (path.dirname(current) === current) return path.resolve(dir);
  }
};

export const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/** The context files a list of references names, at one layer. */
export const contextFiles = (
  refs: readonly string[],
  layer: ContextLayer,
  at: DiagnosticPath,
  options: { workflowDir: string; projectRoot: string },
  diagnostics: Diagnostic[],
): ContextFile[] =>
  refs.flatMap((ref, index) => {
    const file = path.resolve(options.workflowDir, ref);
    const where = [...at, index];
    if (!inside(options.projectRoot, file)) {
      diagnostics.push(
        error("ref.context", `${ref} is outside the project`, where),
      );
      return [];
    }
    if (!existsSync(file)) {
      diagnostics.push(error("ref.context", `${ref} does not exist`, where));
      return [];
    }
    return [
      {
        layer,
        name: path.relative(options.projectRoot, file),
        text: readFileSync(file, "utf8"),
      },
    ];
  });

/** `~/.ork/context/*.md`, in name order. */
export const userContext = (home: string): ContextFile[] => {
  const folder = path.join(home, ".ork", "context");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter(file => file.endsWith(".md"))
    .toSorted()
    .map(file => ({
      layer: "user" as const,
      name: `~/.ork/context/${file}`,
      text: readFileSync(path.join(folder, file), "utf8"),
    }));
};

/** The workflow's accepted lessons, `.ork/lessons/<workflow>.md`, if any. */
export const lessons = (
  workflowName: string,
  projectRoot: string,
): ContextFile[] => {
  const name = path.join(".ork", "lessons", `${workflowName}.md`);
  const file = path.join(projectRoot, name);
  return existsSync(file)
    ? [{ layer: "workflow", name, text: readFileSync(file, "utf8") }]
    : [];
};
