/**
 * @file How a run's lines are drawn: the terminal kit's {@link Term} for the
 *   stream they go to, and what a transcript has to remember between events (a
 *   node's worktree, to show its paths relative to it). Plain, a view draws
 *   today's line-based transcript; rich, it draws chips and cuts to the width.
 */

import { type Term, termOf, type TermStream } from "../term/mode.ts";
import { apply } from "../term/theme.ts";

/** What formatting a transcript keeps from one event to the next. */
export type View = {
  term: Term;
  /** A node's worktree path, from its `worktree` event. */
  roots: Map<string, string>;
};

/** A view for `stream` (stdout when not given), as `env` sets it. */
export const createView = (
  stream: TermStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): View => ({ term: termOf(stream, env), roots: new Map() });

/** A format for `apply`: a color name, or a list of them. */
export type Format = Parameters<typeof apply>[1];

/** Styles text for `term`: no escape codes when it is plain. */
export const styler =
  (term: Term) =>
  (format: Format, text: string): string =>
    apply(term, format, text);
