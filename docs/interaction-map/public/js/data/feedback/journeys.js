/** @file The feedback map's journeys. */

import { DESIGN, FEEDBACK } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "report",
    title: "An agent reports friction",
    who: "builder · Ork · you",
    summary:
      "The builder hits a gap in its brief and says so; the same run adds a signal of its own. Both end up as items in `ork feedback list`.",
    steps: [
      {
        from: "tool",
        title: "The builder calls `feedback`",
        detail:
          'Its brief did not name the spec\'s artifact path, so it spent turns finding it: `feedback(kind: "context-gap", target: "workflow", …)`, with the files it searched as evidence.',
        docs: [DESIGN.feedback],
      },
      {
        from: "tool",
        to: "recorder",
        title: "Within the cap, not a duplicate",
        detail:
          "Its first report this session (the cap is 3), and nothing like it earlier in the run, so it is kept.",
      },
      {
        from: "recorder",
        title: "Masked and fingerprinted",
        detail:
          "Secrets are masked before anything is written. The agent chose the target, so its kind's default is not used. The fingerprint is target, kind, signal code and the title without numbers or punctuation.",
      },
      {
        from: "recorder",
        to: "table",
        title: "It joins an item",
        detail:
          "Two earlier runs reported the same thing, so the item's count goes to 3 and its last seen moves.",
      },
      {
        from: "recorder",
        to: "events",
        title: "`feedback.recorded` in the run's stream",
        detail: "So logs and the UI show it in context.",
      },
      {
        from: "events",
        to: "signals",
        title: "The run's events yield a signal",
        detail:
          "Later, the review loop hits `maxRounds`. No model is asked; the `loop.exhausted` event says it, and the signal is recorded right after it.",
        docs: [DESIGN.feedback],
      },
      {
        from: "signals",
        to: "recorder",
        title: "Recorded the same way",
        detail:
          "Fingerprinted with its code and grouped like the agent's report, with the same origin filled in; its target is `workflow`.",
      },
      {
        from: "you",
        to: "feedbackCmd",
        title: "You run `ork feedback list`",
        detail: "To see what the runs have reported.",
        docs: [DESIGN.cli],
      },
      {
        from: "feedbackCmd",
        to: "table",
        title: "A short list of items",
        detail:
          "Each with its count, first and last seen, and the runs and models it came from. `show` opens one; `dismiss` closes it.",
      },
    ],
  },
  {
    id: "lesson",
    title: "Triage, then a lesson",
    who: "You · Ork's triage",
    summary:
      "You triage new items, accept one as a lesson, and the workflow's next run starts knowing it.",
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback triage`",
        detail: "Over every item still `new`.",
        docs: [DESIGN.cli],
      },
      {
        from: "actions",
        to: "triage",
        title: "Ork merges near-duplicates by rules",
        detail:
          "The same target and kind, and titles that share 80% of their words. It shows each merge and asks first; no model runs.",
        docs: [DESIGN.feedback],
      },
      {
        from: "triage",
        to: "table",
        title: "Items merged",
        detail:
          "Near-duplicates become one item, and what triage saw is marked `triaged`.",
      },
      {
        from: "you",
        to: "actions",
        title: "You accept an item as a lesson",
        detail:
          'The builder\'s context gap: "The spec is at `nodes.spec.output.artifacts.spec`." Feedback is model output, so only your acceptance makes it a lesson.',
      },
      {
        from: "actions",
        to: "apply",
        title: "The lesson is written",
        detail: "The item becomes `accepted`.",
      },
      {
        from: "apply",
        to: "lessons",
        title: "Into `.ork/lessons/software-factory.md`",
        detail: "A committed file you can review, edit and version with git.",
        docs: [DESIGN.feedback],
      },
      {
        from: "lessons",
        to: "compiler",
        title: "The next run loads it",
        detail:
          "As part of the workflow layer, for every node of that workflow, up to 1,500 tokens.",
        docs: [DESIGN.context],
      },
      {
        from: "compiler",
        title: "`ork context explain` shows it",
        detail: "Listed under the workflow layer, with its estimated tokens.",
      },
    ],
  },
  {
    id: "fix",
    title: "Apply a fix",
    who: "You · a fixer node",
    summary:
      "Instead of a lesson, you ask for a real fix; it arrives as a diff you accept or decline.",
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback apply <item>`",
        detail:
          "On a `workflow` or `project` item; it runs Ork's own `ork:feedback-apply`.",
        docs: [DESIGN.cli],
      },
      {
        from: "actions",
        to: "apply",
        title: "`ork:feedback-apply` proposes the fix",
        detail:
          "Ork's own workflow: a worker in a worktree commits, for example, an edit to the builder's brief in the workflow file, or a line in `AGENTS.md`.",
        docs: [DESIGN.feedback],
      },
      {
        from: "apply",
        to: "decisions",
        title: "A gate asks: keep or discard",
        detail: "Nothing is merged, whatever you answer.",
      },
      {
        from: "actions",
        to: "decisions",
        title: "You read it and keep it",
        detail: "Discard, and its branch is removed.",
      },
      {
        from: "apply",
        to: "repoFiles",
        title: "It stays on its branch",
        detail:
          "The item is `resolved`; you review and merge it like any other change.",
      },
    ],
  },
  {
    id: "publish",
    title: "Publish to Ork's Discussions",
    who: "You · your gh · Ork's maintainers",
    summary:
      'You share an `ork` item with Ork\'s maintainers: redacted, previewed, confirmed, and posted with your own `gh`, as a "+1" when the thread exists.',
    steps: [
      {
        from: "you",
        to: "actions",
        title: "You run `ork feedback publish <item>`",
        detail:
          "For an `ork` item, for example a tool error seen in a dozen runs. Opt-in, one item at a time.",
        docs: [DESIGN.feedback],
      },
      {
        from: "actions",
        to: "publish",
        title: "Only `ork` items go out",
        detail: "`workflow` and `project` items stay local.",
      },
      {
        from: "publish",
        title: "Redacted",
        detail:
          "Secrets, emails and hostnames removed; absolute paths rewritten to `<project>/…`; repo and workflow names too, if you ask.",
      },
      {
        from: "publish",
        title: "A header and a marker",
        detail:
          "Ork version, driver, model, node type, kind and count, and a hidden `<!-- ork-fingerprint: … -->`.",
      },
      {
        from: "publish",
        to: "actions",
        title: "You see the exact text",
        detail:
          "In the terminal, or the Feedback panel: what you confirm is what is posted.",
      },
      {
        from: "actions",
        title: "You confirm",
        detail:
          "With `y`, or the panel's Publish; anything else, and nothing leaves your machine.",
      },
      {
        from: "publish",
        to: "gh",
        title: "Your `gh` looks for the marker",
        detail:
          'In the "Agent feedback" category, found by its slug `agent-feedback`.',
      },
      {
        from: "gh",
        to: "discussions",
        title: 'A "+1" on the existing thread',
        detail:
          "With the new context as a comment. With no match, a new discussion starts.",
      },
      {
        from: "table",
        title: "The item is `published`",
        detail: "Its status becomes `published`.",
      },
    ],
  },
  {
    id: "panel-fix",
    title: "A fix from the browser",
    who: "You · `ork ui`",
    summary:
      "The Feedback panel asks for the same fix as `ork feedback apply`, and you keep or discard it in Decisions, while the Monitor shows the run.",
    steps: [
      {
        from: "you",
        to: "panel",
        title: "You choose an item and Propose fix…",
        detail:
          "On a `workflow` or `project` item. The panel names the project it would run in and that it's a paid run, and asks first.",
        docs: [FEEDBACK.panelSpec],
      },
      {
        from: "panel",
        to: "actions",
        title: "The server starts `ork feedback apply`",
        detail:
          "In the background, in the item's project, with a run id it picked, so the panel can go to the run in the Monitor. A settled or dismissed item is refused, by the same rule as in a terminal.",
        docs: [FEEDBACK.applyRoute, FEEDBACK.actions],
      },
      {
        from: "actions",
        to: "apply",
        title: "`ork:feedback-apply` proposes the fix",
        detail:
          "Its worker reads and edits files, runs no command, and Ork commits the change on a branch in a worktree.",
      },
      {
        from: "apply",
        to: "decisions",
        title: "A gate asks: keep or discard",
        detail:
          "With the branch's `git diff --stat` and the command to read the whole change. It shows in the Decisions panel like any question.",
      },
      {
        from: "decisions",
        title: "You keep it in Decisions",
        detail: "Or with `ork decide`. Nothing is merged, whatever you answer.",
      },
      {
        from: "decisions",
        to: "actions",
        title: "`ork feedback apply` reads your answer",
        detail:
          "Kept, the item is `resolved`; discarded, its branch and worktree are removed and the item stays `accepted`. The panel shows it when it reads again.",
      },
      {
        from: "apply",
        to: "repoFiles",
        title: "It stays on its branch",
        detail: "For you to review and merge like any other change.",
      },
    ],
  },
  {
    id: "panel-publish",
    title: "Publish from the browser",
    who: "You · `ork ui` · your gh",
    summary:
      "The Feedback panel previews an `ork` item exactly as it would be posted, and posts it only when you press Post and it's still what you read.",
    steps: [
      {
        from: "you",
        to: "panel",
        title: "You choose an `ork` item and Publish…",
        detail:
          "Only an `ork` item has the button; one published already says why it's off.",
        docs: [FEEDBACK.panelSpec],
      },
      {
        from: "panel",
        to: "publish",
        title: "A preview that only reads",
        detail:
          "The server redacts the item and adds its header and marker, as `ork feedback publish` does.",
        docs: [FEEDBACK.preview, FEEDBACK.publishRoute],
      },
      {
        from: "publish",
        to: "gh",
        title: "Your `gh` looks, and sends nothing",
        detail:
          'It reads the "Agent feedback" category and its 100 newest threads for the item\'s marker, to say whether this is a new thread or a "+1".',
      },
      {
        from: "publish",
        to: "panel",
        title: "The exact text, and its digest",
        detail:
          "Shown as characters, never as Markdown, with where it goes. Hide repository and workflow names reads it again.",
      },
      {
        from: "panel",
        title: "You press Post",
        detail:
          "It's never the dialog's default, so Enter elsewhere doesn't press it. Cancel, and nothing was sent.",
      },
      {
        from: "panel",
        to: "publish",
        title: "Sent only if it's still what you read",
        detail:
          "The server makes the preview again; if its digest isn't the one you saw, nothing is sent and the panel shows the new text.",
      },
      {
        from: "gh",
        to: "discussions",
        title: "Posted with your own `gh`",
        detail:
          'A "+1" with the new context on the thread with the same marker, or a new discussion.',
      },
      {
        from: "table",
        title: "The item is `published`",
        detail: "And Publish is off for it from then on.",
      },
    ],
  },
];
