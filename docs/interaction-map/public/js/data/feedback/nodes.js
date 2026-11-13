/**
 * @file The feedback map's components: you and the commands you read, triage,
 *   apply and publish feedback from; the engine's three ways in (system
 *   signals, the agent's `feedback` tool, your notes), the recorder and the
 *   local table; triage, fixes, lessons and the publish preview; the files they
 *   write; your `gh` and Ork's Discussions. Ork's maintainers' own triage of
 *   the Discussions category is not part of Ork. Coordinates are in map units;
 *   the map is {@link SIZE} wide and tall.
 */

import { CONTEXT, CONTROL, DESIGN, FEEDBACK, STORE } from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1980, h: 960 };

/**
 * The columns, left to right. Rows 1, 2 and 4 of "Your machine" and every row
 * but the second of "Claude runtime" stay empty as corridors.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "people", label: "You", x: 20, w: 260, tone: "violet" },
  { id: "surfaces", label: "CLI and UI", x: 300, w: 260, tone: "blue" },
  { id: "core", label: "Ork engine", x: 580, w: 540, tone: "orange" },
  { id: "machine", label: "Your machine", x: 1140, w: 260, tone: "slate" },
  { id: "runtime", label: "Claude runtime", x: 1420, w: 260, tone: "teal" },
  { id: "github", label: "GitHub", x: 1700, w: 260, tone: "amber" },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [];

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── You ──────────────────────────────────────────────────────────────────
  {
    id: "you",
    title: "You",
    sub: "note · triage · accept · confirm",
    zone: "people",
    x: 40,
    y: 360,
    status: "external",
    pkg: null,
    summary:
      "You add the one signal no event shows, whether a result was useful, and you are the gate: no fix, lesson or post takes effect until you accept it.",
    facts: [
      "Feedback is model output that repo content can steer, so a human accepts every lesson and fix.",
      "Publishing is opt-in, per item, and goes out under your own account.",
    ],
    docs: [DESIGN.feedback],
  },

  // ── CLI and UI ───────────────────────────────────────────────────────────
  {
    id: "feedbackCmd",
    title: "ork feedback",
    sub: "`list` · `show` · `note` · `dismiss`",
    zone: "surfaces",
    x: 320,
    y: 240,
    status: "built",
    pkg: "cli",
    summary:
      "Reads the local feedback items: what was reported, how often, in which runs, workflows and models. It is also one of the places you rate or annotate a node's result.",
    facts: [
      "Built: `list` (newest first; `--all` adds dismissed items), `show <item>` with every record, `dismiss <item>` and `restore <item>`; an item is a prefix of its fingerprint.",
      "Built: `note <run> [<node>] -m <text>` records your note on a run or a node, with `--rating good|bad`; `ork decide --note` notes the node you just answered.",
      "In the browser, **Note…** in the Monitor writes the same note (`POST /api/runs/:id/notes`); all three are checked by one function.",
    ],
    docs: [
      DESIGN.cli,
      DESIGN.feedback,
      FEEDBACK.cli,
      FEEDBACK.cliTests,
      FEEDBACK.human,
      FEEDBACK.noteTests,
      FEEDBACK.noteDialog,
      FEEDBACK.noteDialogTests,
      FEEDBACK.guide,
    ],
  },
  {
    id: "panel",
    title: "Feedback panel",
    sub: "`ork ui` · items by fingerprint",
    zone: "surfaces",
    x: 320,
    y: 360,
    status: "built",
    pkg: "ui",
    src: "packages/ui/src/panels/feedback-panel.tsx",
    summary:
      "The browser twin of `ork feedback`: every item, filtered by the shared filter bar (status, kind, severity, workflow, run) and by what it's about; an item's facts and records, with the way to each run; and what you can do with it.",
    facts: [
      "Built: Dismiss, Restore, Accept, Add lesson…, Propose fix…, Publish… and Split. Which ones an item allows, and why not, is the server's answer by the same rule `ork feedback` keeps.",
      "Add lesson… names the lessons file and how full it is before anything is written. Propose fix… names the project and asks, with a choice of driver, starts `ork feedback apply` in the background, and goes to the run in the Monitor.",
      "Publish… shows exactly what would be posted, and posts only on **Post**, and only if it's still what you read.",
      "Not here: merging, which stays `ork feedback triage`'s; a stream of new feedback, so it reads again when the runs change (L153, L154).",
      "A note on a run or a node is written in the Monitor.",
    ],
    see: [
      { map: "architecture", node: "ui", label: "The UI" },
      { map: "architecture", node: "server", label: "The local server" },
    ],
    docs: [
      FEEDBACK.panelSpec,
      FEEDBACK.guide,
      FEEDBACK.panel,
      FEEDBACK.panelTests,
      FEEDBACK.dialogTests,
      FEEDBACK.axeTests,
      FEEDBACK.routes,
      FEEDBACK.routeTests,
      FEEDBACK.limits,
      DESIGN.ui,
    ],
  },
  {
    id: "actions",
    title: "ork feedback actions",
    sub: "`accept` · `triage` · `apply` · `publish`",
    zone: "surfaces",
    x: 320,
    y: 600,
    status: "built",
    pkg: "cli",
    summary:
      "The subcommands that close the loop: triage new items, apply one as a fix or a lesson, publish an `ork` item, and move feedback as JSONL.",
    facts: [
      "`triage`, `split`, `accept <item> [--lesson]`, `apply <item>`, `publish <item>`, `export` and `import`, beside `list`, `show`, `note`, `dismiss` and `restore`.",
      "What an item allows is one rule in the engine, shared with the Feedback panel: nothing on a dismissed item, no lesson or fix for an `ork` one, publishing only an `ork` one, once.",
    ],
    docs: [
      DESIGN.cli,
      FEEDBACK.guide,
      FEEDBACK.actions,
      FEEDBACK.actionTests,
      FEEDBACK.triageCommand,
      FEEDBACK.apply,
      FEEDBACK.share,
      DESIGN.milestones,
    ],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "events",
    title: "Event store",
    sub: "`~/.ork/state.db` · append-only",
    zone: "core",
    x: 600,
    y: 120,
    status: "built",
    pkg: "core",
    summary:
      "Every run's events, in order. Feedback reads it for signals and writes back to it, so logs and the UI show each report next to what caused it.",
    facts: [
      "Each record is also a `feedback.recorded` event in the run's stream, so `ork logs` shows it beside what caused it.",
      "Evidence is artifact paths and tool names, never pasted file contents.",
    ],
    see: [
      { map: "architecture", node: "eventStore", label: "The event store" },
      { map: "messaging", node: "events", label: "Messages and decisions" },
    ],
    docs: [DESIGN.messaging, DESIGN.feedback, STORE.store],
  },
  {
    id: "signals",
    title: "System signals",
    sub: "from events · no model call",
    zone: "core",
    x: 880,
    y: 120,
    status: "built",
    pkg: "core",
    summary:
      "Friction Ork can see for itself in the event stream, so it costs nothing and is objective.",
    facts: [
      "Built: a loop out of rounds, a budget that ran out, a tool you denied, an Ork tool that failed, a gate that timed out, and an answer other than the recommended one.",
      "Derived where the run's events are recorded, decisions included, and recorded right after the event that shows them.",
      "A node's end files by who should act: Ork's own bug (an unknown or crashed end, with the scrubbed detail), the workflow's, or the agent's context gap. An account's, provider's or user's end is a setup hint, not feedback, and a report the `report` tool refuses is the agent's.",
    ],
    docs: [DESIGN.feedback, FEEDBACK.signals, FEEDBACK.tests, FEEDBACK.adr],
  },
  {
    id: "recorder",
    title: "Feedback recorder",
    sub: "mask · cap · fingerprint",
    zone: "core",
    x: 880,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "Where the three sources meet. It masks secrets, drops duplicates, pre-fills the target, fingerprints the record and writes it.",
    facts: [
      "Masks secrets with the store's patterns, caps an agent at 3 reports a session, and drops a run's duplicates.",
      "Fingerprint: target, kind, signal code, and the title without numbers or punctuation.",
      "Fills in each record's origin: workflow and its hash, node type, model, driver, Ork version. An agent's target defaults from its kind (`bug` is `ork`, `context-gap` and `skill` are `project`).",
    ],
    docs: [
      DESIGN.feedback,
      FEEDBACK.agent,
      FEEDBACK.fingerprint,
      FEEDBACK.signals,
    ],
  },
  {
    id: "table",
    title: "Feedback table",
    sub: "records grouped into items",
    zone: "core",
    x: 600,
    y: 360,
    status: "built",
    pkg: "core",
    summary:
      "The local store, a `feedback` table in `~/.ork/state.db`. Records with one fingerprint form an item, so a thousand records become a short list.",
    facts: [
      "A record: origin (run, workflow and its hash, node, model, driver, Ork version), content and fingerprint.",
      "An item: its status, count, first and last seen, and the runs, workflows and models it was seen in.",
      "Status, kept per item: `new`, `triaged`, `accepted`, `resolved`, `dismissed`, and `published` once it's shared. An item triage merged into another lists under it.",
      "Records carry a `feedbackVersion`; nothing holds a token.",
    ],
    docs: [DESIGN.feedback, FEEDBACK.store, FEEDBACK.tests],
  },
  {
    id: "triage",
    title: "Triage",
    sub: "near-duplicates · by rules",
    zone: "core",
    x: 600,
    y: 480,
    status: "built",
    pkg: "core",
    summary:
      "Merges new items about the same problem by rules, with no model: the same target and kind, and titles that share at least 80% of their words. It shows each merge and asks first.",
    facts: [
      "Run by `ork feedback triage`; what it saw becomes `triaged`.",
      "A summary and a proposed fix come from `apply`, one item at a time, when you ask (ADR-059).",
      "A merged item lists under the one seen first; `ork feedback split` takes it apart.",
    ],
    docs: [
      DESIGN.feedback,
      FEEDBACK.triage,
      FEEDBACK.triageTests,
      FEEDBACK.triageCommand,
      FEEDBACK.loopAdr,
    ],
  },
  {
    id: "compiler",
    title: "Context compiler",
    sub: "lessons in the workflow layer",
    zone: "core",
    x: 880,
    y: 480,
    status: "built",
    pkg: "core",
    summary:
      "Builds each node's session. Accepted lessons load as part of the workflow layer, so the next run of that workflow starts knowing them.",
    facts: [
      "`.ork/lessons/<workflow>.md` loads in the workflow layer when it exists, and `ork context explain` lists it like any other context.",
      "At most 1,500 tokens of it: a longer file is cut on a line's end, and `explain` and the Context panel say so.",
    ],
    see: [
      {
        map: "architecture",
        node: "contextCompiler",
        label: "The context compiler",
      },
      { map: "context", label: "The context map" },
    ],
    docs: [
      CONTEXT.files,
      FEEDBACK.lessonCap,
      CONTEXT.explain,
      DESIGN.context,
      DESIGN.feedback,
    ],
  },
  {
    id: "apply",
    title: "Fixes and lessons",
    sub: "`apply` · accept as a lesson",
    zone: "core",
    x: 600,
    y: 600,
    status: "built",
    pkg: "core",
    summary:
      "`ork feedback apply <item>` runs Ork's own `ork:feedback-apply` workflow, whose worker proposes a fix on a branch; or you accept the item as a lesson. Nothing changes without your answer.",
    facts: [
      "`ork feedback apply` runs `ork:feedback-apply`, a built-in workflow, in the item's project, with that project's records only; its worker can read and edit files but run no command, and Ork commits its fix on a branch in a worktree.",
      "The gate shows the branch's `git diff --stat` and the command to read it all, then the worker's own account; it recommends neither answer, and Ork never merges. Kept, the item is `resolved`; discarded, the branch goes.",
      "`ork feedback accept --lesson` writes a lesson instead, never through a link (ADR-059).",
    ],
    docs: [
      DESIGN.feedback,
      FEEDBACK.apply,
      FEEDBACK.applyTests,
      FEEDBACK.lessons,
      FEEDBACK.accept,
      FEEDBACK.lessonTests,
      FEEDBACK.acceptTests,
      FEEDBACK.applyWorkflow,
      FEEDBACK.builtins,
      FEEDBACK.builtinTests,
      FEEDBACK.loopAdr,
    ],
  },
  {
    id: "decisions",
    title: "Decision queue",
    sub: "keep or discard a fix",
    zone: "core",
    x: 600,
    y: 720,
    status: "built",
    pkg: "core",
    summary:
      "The same queue every question goes through. A proposed fix waits here as the gate of its run: keep the branch, or discard it.",
    facts: [
      "Built: the queue itself (milestone 1d), and the gate of `ork:feedback-apply`, answered in the terminal that runs `ork feedback apply`, with `ork decide`, or in the Decisions panel.",
      "A publish is not a decision: its preview is confirmed in the terminal or the Feedback panel (ADR-059).",
    ],
    see: [
      { map: "messaging", node: "decisions", label: "Decisions in detail" },
      {
        map: "architecture",
        node: "decisionQueue",
        label: "The decision queue",
      },
    ],
    docs: [CONTROL.queue, DESIGN.messaging, DESIGN.feedback],
  },
  {
    id: "publish",
    title: "Publish preview",
    sub: "redact · header · `ork` only",
    zone: "core",
    x: 600,
    y: 840,
    status: "built",
    pkg: "core",
    summary:
      'Turns an `ork`-target item into a post: redacts it, adds a structured header and a fingerprint marker, and shows you the exact text, a new thread or a "+1", before anything leaves your machine.',
    facts: [
      "Redacts secrets, emails, hosts and IPs; your projects' paths become `<project>/…` and your home `~`; `--hide-names` takes out workflow and folder names.",
      "Header: Ork version, driver, model, node type, kind, count.",
      "Every post carries a hidden `<!-- ork-fingerprint: … -->` marker; the newest 100 threads are read for it first.",
      "`ork feedback publish` asks `y/N` with no flag to skip it. The Feedback panel's preview carries a digest of the text; **Post** makes the preview again and sends nothing if it changed.",
    ],
    docs: [
      DESIGN.feedback,
      FEEDBACK.redact,
      FEEDBACK.preview,
      FEEDBACK.discussions,
      FEEDBACK.share,
      FEEDBACK.publishTests,
      FEEDBACK.publishRoute,
      FEEDBACK.publishDialog,
      FEEDBACK.publishDialogTests,
      FEEDBACK.loopAdr,
    ],
  },

  // ── Your machine ─────────────────────────────────────────────────────────
  {
    id: "jsonl",
    title: "Feedback JSONL",
    sub: "`ork feedback export` · `import`",
    zone: "machine",
    x: 1160,
    y: 360,
    status: "built",
    pkg: null,
    summary:
      "Feedback moved as JSON lines, so a team can share it without GitHub. Publish targets are adapters, and this is one.",
    facts: [
      "A line per record; import checks each, masks secrets again and skips what's here; items start `new`.",
      "Issues in the project's own repository can be a later adapter.",
    ],
    docs: [DESIGN.feedback, FEEDBACK.jsonl, FEEDBACK.shareTests],
  },
  {
    id: "lessons",
    title: "Lessons file",
    sub: "`.ork/lessons/<workflow>.md`",
    zone: "machine",
    x: 1160,
    y: 600,
    status: "built",
    pkg: null,
    summary:
      "The accepted lessons of one workflow, in a committed file you can review, edit and version with git.",
    facts: [
      "Only lessons you accepted are in it: one line each, marked with its item so it isn't added twice.",
      "Read into the workflow layer, up to 1,500 tokens; accepting past that is refused, and a longer file is cut.",
    ],
    see: [{ map: "context", node: "workflow", label: "The workflow layer" }],
    docs: [CONTEXT.files, DESIGN.feedback, DESIGN.context],
  },
  {
    id: "repoFiles",
    title: "Workflow and repo",
    sub: "`*.ork.yaml` · `AGENTS.md` · skills",
    zone: "machine",
    x: 1160,
    y: 720,
    status: "external",
    pkg: null,
    summary:
      "What a fix changes: the workflow file, or the repo's own context (`AGENTS.md`, `CLAUDE.md`, skills, docs). The project's files, not Ork's.",
    facts: [
      "`workflow` items are for the workflow's author; `project` items for the repo's maintainers.",
      "A fix arrives as a diff on a branch, for you to merge.",
    ],
    see: [
      {
        map: "architecture",
        node: "projectFiles",
        label: "The project's instructions",
      },
      { map: "context", node: "project", label: "The project layer" },
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "gh",
    title: "Your gh",
    sub: "your account · no Ork backend",
    zone: "machine",
    x: 1160,
    y: 840,
    status: "external",
    pkg: null,
    summary:
      "The GitHub CLI, signed in as you. Ork posts through it like every other integration; there is no Ork-run telemetry service.",
    facts: ["`ork doctor` checks that it is installed and signed in."],
    see: [{ map: "architecture", node: "toolClis", label: "Your tool CLIs" }],
    docs: [DESIGN.feedback],
  },

  // ── Claude runtime ───────────────────────────────────────────────────────
  {
    id: "tool",
    title: "feedback tool",
    sub: "`feedback(kind, target, …)`",
    zone: "runtime",
    x: 1440,
    y: 240,
    status: "built",
    pkg: "runtime",
    summary:
      "One of Ork's MCP tools, given to every agent node, for the friction an agent sees that no event shows. Its description asks for only what materially got in the way, in one line and a short body.",
    facts: [
      "`feedback(kind, target?, title, body?, severity?, evidence?)`.",
      "Kinds: `friction`, `bug`, `context-gap`, `skill`, `workflow`, `idea`. Targets: `ork`, `workflow`, `project`.",
      "Every agent node inside a run gets it, `ork run --node` too; capped at 3 reports a session.",
      "Not for work the change leaves for later: that is a follow-up (`follow_up`), kept apart from feedback and never published or made a lesson.",
    ],
    see: [
      { map: "messaging", node: "mcpTools", label: "Ork's MCP tools" },
      {
        map: "architecture",
        node: "mcpTools",
        label: "The tools in the architecture",
      },
    ],
    docs: [DESIGN.feedback, DESIGN.messaging, FEEDBACK.tool, DESIGN.followUps],
  },

  // ── GitHub ───────────────────────────────────────────────────────────────
  {
    id: "discussions",
    title: "Agent feedback",
    sub: "Discussions · `mimshins/ork`",
    zone: "github",
    x: 1720,
    y: 840,
    status: "external",
    pkg: null,
    summary:
      'The "Agent feedback" category of Ork\'s GitHub Discussions, where maintainers see one thread per real problem, with a count.',
    facts: [
      "Found by its slug, `agent-feedback`, never by id.",
      'A matching fingerprint marker gets a comment and a "+1", not a new discussion.',
      "Triaging the category and promoting threads to issues is the maintainers' own job, outside Ork.",
    ],
    hosts: [
      {
        url: "https://github.com/mimshins/ork/discussions/categories/agent-feedback",
        label: "The category on GitHub",
      },
    ],
    docs: [DESIGN.feedback],
  },
];
