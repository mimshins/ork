/**
 * @file `ork validate`: loads, parses and compiles workflow files with the
 *   agents they name, checks their skill and context references, and reports
 *   diagnostics compiler-style, with file, line and column. `loadWorkflow` is
 *   shared with `ork run`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  type CompiledGraph,
  compileWorkflow,
  contextDiagnostics,
  loadAgents,
  projectRootOf,
} from "@krapht/ork-core";
import {
  type Diagnostic,
  parseWorkflow,
  type Workflow,
} from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { style, write } from "../output.ts";
import { findWorkflowFiles } from "../workflows.ts";

export type FileReport = {
  file: string;
  diagnostics: Diagnostic[];
  summary?: { nodes: number; edges: number; entries: string[] };
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
};

const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some(d => d.severity === "error");

/**
 * Parses and compiles one workflow file, with the agents the user and its
 * project offer. `home` is the user's `~` (tests pass a folder).
 */
export const loadWorkflow = (
  file: string,
  cwd: string,
  home?: string,
): LoadedWorkflow => {
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
    };
  }

  const parsed = parseWorkflow(text);
  if (!parsed.ok) {
    return {
      report: { file, diagnostics: parsed.diagnostics },
      workflow: null,
      graph: null,
    };
  }

  const workflowDir = path.dirname(path.resolve(cwd, file));
  const projectRoot = projectRootOf(workflowDir);
  const catalog = loadAgents({
    projectRoot,
    ...(home === undefined ? {} : { home }),
  });
  const compiled = compileWorkflow(parsed.workflow, { catalog, workflowDir });
  const { graph } = compiled;
  const diagnostics = [
    ...compiled.diagnostics,
    ...(graph === null
      ? []
      : contextDiagnostics(graph.workflow, { workflowDir, projectRoot })),
  ];
  const located: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const position = parsed.locate(diagnostic.path);
    located.push(
      position === null ? diagnostic : { ...diagnostic, ...position },
    );
  }
  if (graph === null) {
    return {
      report: { file, diagnostics: located },
      workflow: null,
      graph: null,
    };
  }
  return {
    report: {
      file,
      diagnostics: located,
      summary: {
        nodes: graph.nodes.size,
        edges: graph.edges.length,
        entries: graph.entries,
      },
    },
    workflow: hasErrors(located) ? null : graph.workflow,
    graph: hasErrors(located) ? null : graph,
  };
};

export const validateFile = (file: string, cwd: string): FileReport =>
  loadWorkflow(file, cwd).report;

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Human-readable report, one line per diagnostic, compiler style. */
export const formatReport = (report: FileReport): string[] => {
  const lines = report.diagnostics.map(d => {
    const where =
      d.line === undefined
        ? report.file
        : `${report.file}:${d.line}:${d.column ?? 1}`;
    const severity =
      d.severity === "error"
        ? style(["red", "bold"], "error")
        : style(["yellow", "bold"], "warning");
    return `${style("dim", where)} ${severity} ${d.message} ${style("dim", `(${d.code})`)}`;
  });
  const errors = report.diagnostics.filter(d => d.severity === "error").length;
  const warnings = report.diagnostics.length - errors;
  if (report.summary !== undefined && errors === 0) {
    const { nodes, edges, entries } = report.summary;
    const extra = warnings > 0 ? `, ${plural(warnings, "warning")}` : "";
    lines.push(
      `${style("green", "✓")} ${report.file} ${style(
        "dim",
        `(${plural(nodes, "node")}, ${plural(edges, "edge")}, starts at ${entries.join(", ")}${extra})`,
      )}`,
    );
  } else {
    lines.push(
      `${style("red", "✗")} ${report.file} ${style(
        "dim",
        `(${plural(errors, "error")}, ${plural(warnings, "warning")})`,
      )}`,
    );
  }
  return lines;
};

export const validate = defineCommand({
  meta: {
    name: "validate",
    description:
      "Check workflow files: schema, ownership tree, edges, loops, and references",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print the reports as JSON",
      default: false,
    },
  },
  run: ({ args }) => {
    const cwd = process.cwd();
    const files = findWorkflowFiles(args._, cwd);
    if (files.length === 0) {
      write("No workflow files found. Run `ork init`, or pass a path.");
      process.exitCode = 1;
      return;
    }
    const reports = files.map(file => validateFile(file, cwd));
    if (args.json) {
      write(JSON.stringify(reports, undefined, 2));
    } else {
      for (const report of reports) {
        for (const line of formatReport(report)) write(line);
      }
    }
    if (reports.some(r => hasErrors(r.diagnostics))) {
      process.exitCode = 1;
    }
  },
});
