/**
 * @file How `ork validate` reports a file: its diagnostics compiler style, then
 *   a verdict line. Rich, a diagnostic is a chip with its message wrapped under
 *   it and its code dimmed, and the verdict an `OK` or `FAIL` chip; plain, the
 *   lines `ork validate` always printed.
 */

import type { Diagnostic } from "@krapht/ork-schema";

import { style } from "../output.ts";
import { CHIP_LABELS, chip } from "../term/chips.ts";
import { cut, widthOf, wrap } from "../term/layout.ts";
import { type Term, termOf } from "../term/mode.ts";
import { paint } from "../term/theme.ts";
import type { FileReport } from "./validate.ts";
import { pathLines, walkLine } from "./walk-report.ts";

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const diagnosticLine = (file: string, d: Diagnostic, term: Term): string[] => {
  const at = d.file ?? file;
  const where = d.line === undefined ? at : `${at}:${d.line}:${d.column ?? 1}`;
  if (term.rich) {
    const error = d.severity === "error";
    const mark = error
      ? chip(term, CHIP_LABELS.error, "danger")
      : chip(term, CHIP_LABELS.warn, "warn");
    // The message wraps under the chip; its code is dimmed on its own line.
    return [
      `${mark} ${paint(term, "muted", cut(where, term.width - 9))}`,
      ...wrap(d.message, term.width - 2).map(line => `  ${line}`),
      `  ${paint(term, "muted", `(${d.code})`)}`,
    ];
  }
  const severity =
    d.severity === "error"
      ? style(["red", "bold"], "error")
      : style(["yellow", "bold"], "warning");
  return [
    `${style("dim", where)} ${severity} ${d.message} ${style("dim", `(${d.code})`)}`,
  ];
};

/** The warnings alone, for a run that goes ahead despite them. */
export const warningLines = (
  report: FileReport,
  // Only a run's warnings use this, and they go to stderr.
  term: Term = termOf(process.stderr),
): string[] =>
  report.diagnostics
    .filter(d => d.severity === "warning")
    .flatMap(d => diagnosticLine(report.file, d, term));

/** The verdict line: `OK` or `FAIL` chip when rich, else `✓` or `✗`. */
const verdictLine = (
  term: Term,
  ok: boolean,
  file: string,
  note: string,
): string => {
  const mark = term.rich
    ? chip(term, ok ? CHIP_LABELS.ok : CHIP_LABELS.fail, ok ? "ok" : "danger")
    : style(ok ? "green" : "red", ok ? "✓" : "✗");
  const room = term.rich
    ? Math.max(8, term.width - widthOf(file) - 8)
    : Infinity;
  return `${mark} ${file}${note === "" ? "" : ` ${style("dim", cut(note, room))}`}`;
};

/** Human-readable report, one line per diagnostic, compiler style. */
export const formatReport = (
  report: FileReport,
  showsPaths = false,
  term: Term = termOf(process.stdout),
): string[] => {
  const lines = report.diagnostics.flatMap(d =>
    diagnosticLine(report.file, d, term),
  );
  const errors = report.diagnostics.filter(d => d.severity === "error").length;
  const warnings = report.diagnostics.length - errors;
  if (report.summary === undefined && errors === 0) {
    lines.push(
      verdictLine(
        term,
        true,
        report.file,
        warnings === 0 ? "" : `(${plural(warnings, "warning")})`,
      ),
    );
  } else if (report.summary !== undefined && errors === 0) {
    const { nodes, edges, entries } = report.summary;
    const extra = warnings > 0 ? `, ${plural(warnings, "warning")}` : "";
    lines.push(
      verdictLine(
        term,
        true,
        report.file,
        `(${plural(nodes, "node")}, ${plural(edges, "edge")}, starts at ${entries.join(", ")}${extra})`,
      ),
    );
  } else {
    lines.push(
      verdictLine(
        term,
        false,
        report.file,
        `(${plural(errors, "error")}, ${plural(warnings, "warning")})`,
      ),
    );
  }
  return [...lines, ...walkLine(report.walk, showsPaths)];
};

/** A report's lines, and with `showsPaths` each path the walk found. */
export const reportLines = (
  report: FileReport,
  showsPaths: boolean,
): string[] => [
  ...formatReport(report, showsPaths),
  ...(showsPaths ? pathLines(report.walk) : []),
];
