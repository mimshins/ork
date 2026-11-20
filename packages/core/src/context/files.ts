/**
 * @file Context files for the context compiler: the user's `~/.ork/context`,
 *   the files a workflow or node names, the workflow's accepted lessons, and
 *   the project root that every reference must stay inside.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Diagnostic, DiagnosticPath } from "@krapht/ork-schema";

import { error } from "../graph/diagnostics.ts";
import { plainPathInside } from "../project/plain-files.ts";
import { capLessons } from "./lesson-cap.ts";

export type ContextLayer = "user" | "workflow" | "node";

export type ContextFile = {
  layer: ContextLayer;
  /** Repository-relative, or `~/.ork/…` for the user layer. */
  name: string;
  text: string;
  /** A lessons file cut at its cap: the whole file's tokens. */
  cutFrom?: number;
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

/**
 * Where a resolved reference is read from. In an attached project (an Ork
 * folder that isn't `<projectRoot>/.ork`), a path inside `<projectRoot>/.ork/`
 * reads the same relative path in that folder, so the references an in-repo
 * project writes work unchanged; `undefined` for anything else.
 */
const attachedSource = (
  file: string,
  projectRoot: string,
  orkDir: string | undefined,
): { file: string; orkDir: string } | undefined => {
  const dotOrk = path.join(path.resolve(projectRoot), ".ork");
  if (orkDir === undefined || path.resolve(orkDir) === dotOrk) return undefined;
  return inside(dotOrk, file)
    ? { file: path.join(orkDir, path.relative(dotOrk, file)), orkDir }
    : undefined;
};

/** A folder for a message: `~/…` under `home`, else as it is. */
const shownFolder = (dir: string, home: string): string =>
  inside(home, dir) ? path.join("~", path.relative(home, dir)) : dir;

/** The context files a list of references names, at one layer. */
export const contextFiles = (
  refs: readonly string[],
  layer: ContextLayer,
  at: DiagnosticPath,
  options: {
    workflowDir: string;
    projectRoot: string;
    refRoot?: string | undefined;
    /** Ork's folder for the project; an attached one's maps `.ork/` refs. */
    orkDir?: string | undefined;
    /** `~`, for messages that name the attached folder. */
    home?: string | undefined;
  },
  diagnostics: Diagnostic[],
): ContextFile[] =>
  refs.flatMap((ref, index) => {
    const file = path.resolve(options.workflowDir, ref);
    const where = [...at, index];
    const source = attachedSource(file, options.projectRoot, options.orkDir);
    const folder =
      source === undefined
        ? ""
        : shownFolder(source.orkDir, options.home ?? homedir());
    if (source === undefined) {
      if (!inside(options.refRoot ?? options.projectRoot, file)) {
        diagnostics.push(
          error("ref.context", `${ref} is outside the project`, where),
        );
        return [];
      }
    } else if (!plainPathInside(source.orkDir, source.file)) {
      // A link could aim a cloned repository's reference at any file of the person's.
      diagnostics.push(
        error(
          "ref.context",
          `${ref} is a link, or behind one, or leaves ${folder}: Ork reads only plain files inside it`,
          where,
        ),
      );
      return [];
    }
    const read = source?.file ?? file;
    if (!existsSync(read)) {
      diagnostics.push(
        error(
          "ref.context",
          `${ref} does not exist${source === undefined ? "" : ` in ${folder}`}`,
          where,
        ),
      );
      return [];
    }
    return [
      {
        layer,
        name: path.relative(options.projectRoot, file),
        text: readFileSync(read, "utf8"),
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

/**
 * The workflow's accepted lessons, `<lessons>/<workflow>.md` (`.ork/lessons/`
 * in the repository by default), if any, cut at their cap (ADR-059). A file
 * that is a link, or behind one, isn't read: a cloned repository could aim it
 * at any file of the person's, and every session would load it.
 */
export const lessons = (
  workflowName: string,
  projectRoot: string,
  folder: string = path.join(projectRoot, ".ork", "lessons"),
): ContextFile[] => {
  const file = path.join(folder, `${workflowName}.md`);
  const name = inside(projectRoot, file)
    ? path.relative(projectRoot, file)
    : file;
  const base = inside(projectRoot, folder) ? projectRoot : path.dirname(folder);
  if (!existsSync(file) || !plainPathInside(base, file)) return [];
  const capped = capLessons(readFileSync(file, "utf8"));
  return [{ layer: "workflow", name, ...capped }];
};
