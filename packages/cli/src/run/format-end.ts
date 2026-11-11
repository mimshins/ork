/**
 * @file How a node's end reads on the terminal (specs/runtime/session-ends.md):
 *   its kind's label and Ork's own message, a note for a kind that may pass,
 *   the setup hint for an account or provider end, and the scrubbed raw detail
 *   only when asked for. Never the provider's own words first.
 */

import {
  END_KINDS,
  endOf,
  type RunEvent,
  type SessionEnd,
} from "@krapht/ork-core";

import { cost } from "../output.ts";
import type { Term } from "../term/mode.ts";
import { hasConflict, nodeVerdict } from "./verdict.ts";
import { createView, styler } from "./view.ts";

/** What a transient kind says in place of its hint on the log line. */
const MAY_PASS = "(may pass; ork resume retries)";

/** `Turn limit: reached its turn limit (8)`, with a note when it may pass. */
export const endHeadline = (end: SessionEnd): string => {
  const { label, transient } = END_KINDS[end.kind];
  return `${label}: ${end.message}${transient ? ` ${MAY_PASS}` : ""}`;
};

/**
 * The lines under a headline: the hint for an account or provider end (what to
 * set up) or whenever `full` (`--verbose`, one node's log), and the detail only
 * when `full`. A transient kind's hint is its retry wording, which the headline
 * already says, so it is not printed twice.
 */
export const endLines = (
  end: SessionEnd,
  full: boolean,
  term: Term = createView().term,
): string[] => {
  const style = styler(term);
  const { actor, hint, transient } = END_KINDS[end.kind];
  const setup = actor === "account" || actor === "provider";
  const lines: string[] = [];
  if (hint !== "" && !transient && (full || setup)) {
    lines.push(`  ${style("dim", hint)}`);
  }
  if (full && end.detail !== undefined) {
    lines.push(
      style("dim", "  details:"),
      ...end.detail.split("\n").map(line => style("dim", `    ${line}`)),
    );
  }
  return lines;
};

/**
 * A finished node's line under `tag`: its verdict, or for a failure its kind
 * and message (and the lines under it). The agent's own summary stays for a
 * `fail` it reported, and an old run's text no rule reads stays as stored.
 */
export const formatFinished = (
  event: Extract<RunEvent, { type: "node.finished" }>,
  tag: string,
  verbose: boolean,
  term: Term = createView().term,
  /** The tag on the lines under the first; the same tag when not given. */
  rest: string = tag,
): string[] => {
  const style = styler(term);
  const conflict = hasConflict(event.output);
  const mark = event.ok
    ? style(conflict ? "yellow" : "green", conflict ? "!" : "✓")
    : style("red", "✗");
  const spent =
    event.usage === undefined
      ? ""
      : style("dim", ` · ${cost(event.usage.costUsd)}`);
  const end = endOf(event);
  const says =
    !event.ok &&
    end.kind !== "reported_failure" &&
    (event.end !== undefined || end.kind !== "unknown");
  if (!says) {
    return [
      `${tag} ${mark} ${nodeVerdict(event.output, event.ok, event.error)}${spent}`,
    ];
  }
  return [
    `${tag} ${mark} ${endHeadline(end)}${spent}`,
    ...endLines(end, verbose, term).map(line => `${rest} ${line}`),
  ];
};
