/**
 * @file `ork validate`: loads, parses and compiles workflow files with the
 *   project's rules (`.ork/project.yaml`) and the agents they name, checks
 *   their skill and context references, and reports diagnostics compiler-style,
 *   with file, line and column. `loadWorkflow` is shared with `ork run`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  checkWorkflowText,
  type CompiledGraph,
  placeFiles,
  placeFor,
  type ProjectPlace,
  readProjectTriggers,
  type WalkResult,
  walkChecks,
  workflowDirOf,
  workflowTextHash,
} from "@krapht/ork-core";
import type { Diagnostic, Locate, Workflow } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { write, writeErr } from "../output.ts";
import { projectAt, registeredProjects } from "../project/place.ts";
import { driverArg, driverDiagnostics } from "../run/driver-check.ts";
import { findWorkflowFiles, refusedBuiltin } from "../workflows.ts";
import { formatReport, reportLines, warningLines } from "./validate-report.ts";

const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some(d => d.severity === "error");

export type FileReport = {
  file: string;
  diagnostics: Diagnostic[];
  summary?: { nodes: number; edges: number; entries: string[] };
  /** What walking it found; a run of one node, or one with errors, has none. */
  walk?: WalkResult;
};

export type LoadedWorkflow = {
  report: FileReport;
  /**
   * The effective workflow (agent nodes filled from their agents), or `null`
   * when it has errors.
   */
  workflow: Workflow | null;
  /** The compiled graph, or `null` when the workflow has errors. */
  graph: CompiledGraph | null;
  /** The project the workflow belongs to, in the repository or attached. */
  place: ProjectPlace;
  /** Where its relative paths resolve from (ADR-035). */
  workflowDir: string;
  /** The hash of the text read, which a trigger's run checks. */
  textHash?: string;
  /** Finds a diagnostic's line and column in the text. */
  locate?: Locate;
};

/**
 * Parses and compiles one workflow file, with the agents the user and its
 * project offer. `home` is the user's `~` (tests pass a folder); `registered`
 * the projects a caller's store has, else those of the store in `home`.
 */
export const loadWorkflow = (
  file: string,
  cwd: string,
  home?: string,
  registered: readonly ProjectPlace[] = registeredProjects(home),
): LoadedWorkflow => {
  const absolute = path.resolve(cwd, file);
  const place = placeFor(path.dirname(absolute), registered);
  const workflowDir = workflowDirOf(place, absolute);
  const where = { place, workflowDir };
  let text: string;
  try {
    text = readFileSync(path.resolve(cwd, file), "utf8");
  } catch (error) {
    const reason =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "file not found"
        : "cannot read file";
    return {
      report: {
        file,
        diagnostics: [
          { severity: "error", code: "file.read", message: reason, path: [] },
        ],
      },
      workflow: null,
      graph: null,
      ...where,
    };
  }

  const { diagnostics, workflow, graph, summary, locate } = checkWorkflowText(
    text,
    { ...where, registered, home },
  );
  return {
    report: {
      file,
      diagnostics,
      ...(summary === undefined ? {} : { summary }),
    },
    workflow,
    graph,
    textHash: workflowTextHash(text),
    ...(locate === undefined ? {} : { locate }),
    ...where,
  };
};

export const validateFile = (file: string, cwd: string): FileReport =>
  loadWorkflow(file, cwd).report;

/**
 * Walks what loaded, with its findings on its report. `ork validate` and `ork
 * run` do this; the rest of what loads a workflow doesn't pay for a walk.
 */
export const walkLoaded = async (
  loaded: LoadedWorkflow,
): Promise<LoadedWorkflow> => {
  const { diagnostics, walk } = await walkChecks({
    diagnostics: loaded.report.diagnostics,
    graph: loaded.graph,
    ...(loaded.locate === undefined ? {} : { locate: loaded.locate }),
  });
  return {
    ...loaded,
    report: {
      ...loaded.report,
      diagnostics,
      ...(walk === undefined ? {} : { walk }),
    },
  };
};

// Where `ork run` and the tests have always found them.
export { formatReport, warningLines };

export const validate = defineCommand({
  meta: {
    name: "validate",
    description:
      "Check workflow files: schema, ownership tree, edges, loops and references, and walk every way through them",
  },
  args: {
    files: {
      type: "positional",
      description:
        "Workflow files or names in .ork/workflows/ (default: every workflow there, and the project's triggers)",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Print the reports as JSON",
      default: false,
    },
    paths: {
      type: "boolean",
      description:
        "List each way a run can end, and the choices that lead there",
      default: false,
    },
    driver: {
      type: "string",
      description:
        "Check the nodes against this driver (default: the one a run would take, the one ready here)",
    },
  },
  run: async ({ args }) => {
    const driver = driverArg(args.driver);
    if (!driver.ok) {
      writeErr(driver.error);
      process.exitCode = 1;
      return;
    }
    const cwd = process.cwd();
    if (refusedBuiltin(args._, cwd)) return;
    const files = findWorkflowFiles(
      args._,
      cwd,
      placeFiles(projectAt(cwd)).workflows,
    );
    if (files.length === 0) {
      write("No workflow files found. Run `ork init`, or pass a path.");
      process.exitCode = 1;
      return;
    }
    const place = projectAt(cwd);
    const triggers =
      args._.length === 0
        ? readProjectTriggers(place, undefined, registeredProjects())
        : undefined;
    // One at a time: a walk's limit is on the clock, which others would share.
    const walked: FileReport[] = [];
    for (const file of files) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      const loaded = await walkLoaded(loadWorkflow(file, cwd));
      const { report } = loaded;
      if (loaded.workflow !== null) {
        report.diagnostics.push(
          // oxlint-disable-next-line eslint/no-await-in-loop -- see above
          ...(await driverDiagnostics(loaded.workflow, {
            override: driver.driver,
            locate: loaded.locate,
          })),
        );
      }
      walked.push(report);
    }
    const reports: FileReport[] = [
      ...walked,
      // The project's triggers are read with its workflows, not when one is named.
      ...(triggers?.present === true
        ? [
            {
              file: path.relative(cwd, triggers.file),
              diagnostics: [
                ...triggers.diagnostics,
                ...triggers.triggers.flatMap(item => item.diagnostics),
              ],
            },
          ]
        : []),
    ];
    if (args.json) {
      write(JSON.stringify(reports, undefined, 2));
    } else {
      for (const report of reports) {
        for (const line of reportLines(report, args.paths)) write(line);
      }
    }
    if (reports.some(r => hasErrors(r.diagnostics))) {
      process.exitCode = 1;
    }
  },
});
