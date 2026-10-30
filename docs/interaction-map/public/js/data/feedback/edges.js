/**
 * @file The feedback map's connections. Corridors in use: row 2 of the engine's
 *   left column and of "Your machine" (`y` 276, into the recorder); the
 *   engine's right column below the compiler (`y` 396, 636, 756, 876); the
 *   runtime column's bottom row (`y` 876, to GitHub). Lane `x` 566 runs from
 *   the actions down to the publish preview.
 */

import { DESIGN } from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "you-feedbackCmd",
    from: "you",
    to: "feedbackCmd",
    kind: "human",
    label: "read · rate · annotate",
    detail:
      "List and inspect items, dismiss one, or rate or annotate a node's result.",
    status: "specified",
  },
  {
    id: "you-panel",
    from: "you",
    to: "panel",
    kind: "human",
    label: "the same, in the browser",
    detail: "Items grouped by fingerprint and target, with every action.",
    status: "planned",
  },
  {
    id: "you-actions",
    from: "you",
    to: "actions",
    kind: "human",
    label: "triage · apply · publish",
    detail: "Each one is explicit and per item; nothing runs on its own.",
    status: "planned",
  },

  // ── CLI and UI ───────────────────────────────────────────────────────────
  {
    id: "feedbackCmd-recorder",
    from: "feedbackCmd",
    to: "recorder",
    kind: "local",
    label: "human note",
    detail:
      "Your rating or note on a node's result, the best signal for whether it was useful. Recorded like any other source.",
    status: "specified",
    docs: [DESIGN.feedback],
  },
  {
    id: "feedbackCmd-table",
    from: "feedbackCmd",
    to: "table",
    kind: "local",
    label: "list · show · dismiss",
    detail: "Reads items and their records; `dismiss` sets the item's status.",
    status: "specified",
    docs: [DESIGN.cli],
  },
  {
    id: "panel-table",
    from: "panel",
    to: "table",
    kind: "net",
    label: "items over REST",
    detail: "Through the local server, over the same table.",
    status: "planned",
    docs: [DESIGN.ui],
  },
  {
    id: "actions-triage",
    from: "actions",
    to: "triage",
    kind: "local",
    label: "`triage`",
    detail: "Starts a run of the built-in triage workflow over new items.",
    status: "planned",
  },
  {
    id: "actions-apply",
    from: "actions",
    to: "apply",
    kind: "local",
    label: "`apply <item>` · lesson",
    detail: "Asks for a fix to be proposed, or accepts the item as a lesson.",
    status: "planned",
  },
  {
    id: "actions-decisions",
    from: "actions",
    to: "decisions",
    kind: "local",
    label: "preview ⇄ your answer",
    detail:
      "The command shows the proposed diff or the exact post, and resolves the decision with your answer.",
    status: "planned",
    both: true,
  },
  {
    id: "actions-publish",
    from: "actions",
    to: "publish",
    kind: "local",
    label: "`publish <item>`",
    detail: "Refused for any item whose target is not `ork`.",
    status: "planned",
    via: [
      [566, 656],
      [566, 876],
    ],
    docs: [DESIGN.feedback],
  },

  // ── Capture ──────────────────────────────────────────────────────────────
  {
    id: "events-signals",
    from: "events",
    to: "signals",
    kind: "event",
    label: "the run's events",
    detail:
      "Signals are derived from events already recorded, with no model call.",
    status: "specified",
  },
  {
    id: "signals-recorder",
    from: "signals",
    to: "recorder",
    kind: "local",
    label: "system signal",
    detail: "For example: the review loop hit `maxRounds` and escalated.",
    status: "specified",
    docs: [DESIGN.feedback],
  },
  {
    id: "tool-recorder",
    from: "tool",
    to: "recorder",
    kind: "local",
    label: "agent report",
    detail:
      "Over the session's cap, or a duplicate within the run, the report is dropped.",
    status: "specified",
    docs: [DESIGN.feedback],
  },
  {
    id: "recorder-events",
    from: "recorder",
    to: "events",
    kind: "event",
    label: "`feedback.recorded`",
    detail: "So logs and the UI show the report in context.",
    status: "specified",
  },
  {
    id: "recorder-table",
    from: "recorder",
    to: "table",
    kind: "local",
    label: "masked record",
    detail:
      "Written with its fingerprint; it joins the item with that fingerprint or starts one.",
    status: "specified",
    docs: [DESIGN.feedback],
  },

  // ── Closing the loop ─────────────────────────────────────────────────────
  {
    id: "table-triage",
    from: "table",
    to: "triage",
    kind: "local",
    label: "new items ⇄ summaries",
    detail:
      "Triage reads `new` items and writes back merged items, a summary each and a proposed fix; they become `triaged`.",
    status: "planned",
    both: true,
  },
  {
    id: "table-jsonl",
    from: "table",
    to: "jsonl",
    kind: "file",
    label: "export ⇄ import",
    detail: "Items as JSON lines, written out or read back in.",
    status: "planned",
    both: true,
  },
  {
    id: "apply-decisions",
    from: "apply",
    to: "decisions",
    kind: "local",
    label: "proposed diff ⇄ answer",
    detail: "The fix waits as a decision; declined, nothing changes.",
    status: "planned",
    both: true,
    docs: [DESIGN.feedback],
  },
  {
    id: "apply-lessons",
    from: "apply",
    to: "lessons",
    kind: "file",
    label: "accepted lesson",
    detail: "Appended to the workflow's lessons file.",
    status: "planned",
  },
  {
    id: "apply-repoFiles",
    from: "apply",
    to: "repoFiles",
    kind: "git",
    label: "a diff on a branch",
    detail: "Only after you accept the proposed fix.",
    status: "planned",
  },
  {
    id: "lessons-compiler",
    from: "lessons",
    to: "compiler",
    kind: "file",
    label: "read into the workflow layer",
    detail:
      "Every later run of the workflow loads its lessons, up to the token cap.",
    status: "planned",
    docs: [DESIGN.context],
  },
  {
    id: "publish-decisions",
    from: "publish",
    to: "decisions",
    kind: "local",
    label: "exact text ⇄ confirm",
    detail: "The redacted post, header included, waits for your confirmation.",
    status: "planned",
    both: true,
  },
  {
    id: "publish-gh",
    from: "publish",
    to: "gh",
    kind: "process",
    label: "search marker · post",
    detail:
      "Runs your `gh` to look for the fingerprint marker, then to comment or to start a discussion.",
    status: "planned",
    docs: [DESIGN.feedback],
  },
  {
    id: "gh-discussions",
    from: "gh",
    to: "discussions",
    kind: "net",
    label: 'comment "+1" or new thread',
    detail:
      "An existing thread with the same marker gets a comment with the new context; otherwise a new discussion in the category.",
    status: "planned",
  },
];
