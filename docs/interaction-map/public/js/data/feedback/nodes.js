/**
 * @file The feedback map's components: you and the commands you read, triage,
 *   apply and publish feedback from; the engine's three ways in (system
 *   signals, the agent's `feedback` tool, your notes), the recorder and the
 *   local table; triage, fixes, lessons and the publish preview; the files they
 *   write; your `gh` and Ork's Discussions. Nothing here is built yet.
 *   Coordinates are in map units; the map is {@link SIZE} wide and tall.
 */

import { DESIGN } from "../refs.js";

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
    sub: "`list` · `show` · `dismiss`",
    zone: "surfaces",
    x: 320,
    y: 240,
    status: "specified",
    pkg: "cli",
    summary:
      "Reads the local feedback items: what was reported, how often, in which runs, workflows and models. It is also one of the places you rate or annotate a node's result.",
    facts: [
      "`list`, `show` and `dismiss` are milestone 1d.",
      "Human notes also come from `ork decide` and the UI; the design gives them no milestone.",
    ],
    docs: [DESIGN.cli, DESIGN.feedback, DESIGN.milestones],
  },
  {
    id: "panel",
    title: "Feedback panel",
    sub: "`ork ui` · items by fingerprint",
    zone: "surfaces",
    x: 320,
    y: 360,
    status: "planned",
    pkg: "ui",
    summary:
      "The browser view of the same items, grouped by fingerprint and target, with triage, apply, accept as a lesson, and the publish preview.",
    facts: ["Milestone 2, with the rest of the UI."],
    see: [{ map: "architecture", node: "ui", label: "The UI" }],
    docs: [DESIGN.ui],
  },
  {
    id: "actions",
    title: "ork feedback actions",
    sub: "`triage` · `apply` · `publish`",
    zone: "surfaces",
    x: 320,
    y: 600,
    status: "planned",
    pkg: "cli",
    summary:
      "The subcommands that close the loop: triage new items, apply one as a fix or a lesson, publish an `ork` item, and move feedback as JSONL.",
    facts: [
      "`ork feedback triage`, `apply <item>`, `publish <item>`, `export`, `import`.",
      "Milestone 2; milestone 1d ships only `list`, `show` and `dismiss`.",
    ],
    docs: [DESIGN.cli, DESIGN.milestones],
  },

  // ── Engine ───────────────────────────────────────────────────────────────
  {
    id: "events",
    title: "Event store",
    sub: "`~/.ork/state.db` · append-only",
    zone: "core",
    x: 600,
    y: 120,
    status: "specified",
    pkg: "core",
    summary:
      "Every run's events, in order. Feedback reads it for signals and writes back to it, so logs and the UI show each report next to what caused it.",
    facts: [
      "Each record is also a `feedback.recorded` event in the run's stream.",
      "Evidence points at event ids and artifact paths, never pasted file contents.",
    ],
    see: [
      { map: "architecture", node: "eventStore", label: "The event store" },
      { map: "messaging", node: "events", label: "Messages and decisions" },
    ],
    docs: [DESIGN.messaging, DESIGN.feedback],
  },
  {
    id: "signals",
    title: "System signals",
    sub: "from events · no model call",
    zone: "core",
    x: 880,
    y: 120,
    status: "specified",
    pkg: "core",
    summary:
      "Friction Ork can see for itself in the event stream, so it costs nothing and is objective.",
    facts: [
      "A loop hit `maxRounds`, an escalation, a budget overrun, a permission denial, a tool error.",
      "A decision that timed out, or you overriding a recommended option.",
      "Milestone 1d.",
    ],
    docs: [DESIGN.feedback, DESIGN.milestones],
  },
  {
    id: "recorder",
    title: "Feedback recorder",
    sub: "mask · cap · fingerprint",
    zone: "core",
    x: 880,
    y: 240,
    status: "specified",
    pkg: "core",
    summary:
      "Where the three sources meet. It masks secrets, drops duplicates, pre-fills the target, fingerprints the record and writes it.",
    facts: [
      "Secrets are masked on write, with the same patterns the publish redaction uses.",
      "Fingerprint: target, kind, tool or error code, normalized title.",
      "Target from the evidence: a tool error is `ork`, a missing input in a brief is `workflow`.",
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "table",
    title: "Feedback table",
    sub: "records grouped into items",
    zone: "core",
    x: 600,
    y: 360,
    status: "specified",
    pkg: "core",
    summary:
      "The local store, a `feedback` table in `~/.ork/state.db`. Records with one fingerprint form an item, so a thousand records become a short list.",
    facts: [
      "A record: origin (run, workflow and its hash, node, model, driver, Ork version), content, status and fingerprint.",
      "An item: its count, first and last seen, and the runs, workflows and models it was seen in.",
      "Status: `new → triaged → accepted | dismissed`, then `published` or `resolved`.",
      "Versioned by `feedbackVersion`; never holds a token.",
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "triage",
    title: "ork:feedback-triage",
    sub: "built-in workflow · new items",
    zone: "core",
    x: 600,
    y: 480,
    status: "planned",
    pkg: null,
    summary:
      "A workflow that ships with Ork and runs on its own engine over new items: it merges near-duplicates, summarizes each item and proposes a fix.",
    facts: [
      "Run by `ork feedback triage`.",
      "Later, a scheduled job on the maintainers' side runs it over the Discussions category.",
      "Milestone 2.",
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "compiler",
    title: "Context compiler",
    sub: "lessons in the workflow layer",
    zone: "core",
    x: 880,
    y: 480,
    status: "specified",
    pkg: "core",
    summary:
      "Builds each node's session. Accepted lessons load as part of the workflow layer, so the next run of that workflow starts knowing them.",
    facts: [
      "Under a token cap, by default 1,500 tokens.",
      "`ork context explain` lists lessons like any other context.",
      "The compiler is milestone 1c; lessons are milestone 2.",
    ],
    see: [
      {
        map: "architecture",
        node: "contextCompiler",
        label: "The context compiler",
      },
      { map: "context", label: "The context map" },
    ],
    docs: [DESIGN.context, DESIGN.feedback],
  },
  {
    id: "apply",
    title: "Fixes and lessons",
    sub: "`apply` · accept as a lesson",
    zone: "core",
    x: 600,
    y: 600,
    status: "planned",
    pkg: "core",
    summary:
      "`ork feedback apply <item>` runs a node that proposes a fix as a diff; or you accept the item as a lesson. Nothing changes without your answer.",
    facts: [
      "A fix: a workflow edit, or an `AGENTS.md`, `CLAUDE.md` or skill change, on a branch.",
      "The proposed fix is a decision.",
      "Milestone 2.",
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "decisions",
    title: "Decision queue",
    sub: "proposed fix · publish preview",
    zone: "core",
    x: 600,
    y: 720,
    status: "specified",
    pkg: "core",
    summary:
      "The same queue every question goes through. A proposed fix and the exact text of a post wait here for you.",
    facts: [
      "The queue is milestone 1d; its feedback decisions are milestone 2.",
    ],
    see: [
      { map: "messaging", node: "decisions", label: "Decisions in detail" },
      {
        map: "architecture",
        node: "decisionQueue",
        label: "The decision queue",
      },
    ],
    docs: [DESIGN.messaging, DESIGN.feedback],
  },
  {
    id: "publish",
    title: "Publish preview",
    sub: "redact · header · `ork` only",
    zone: "core",
    x: 600,
    y: 840,
    status: "planned",
    pkg: "core",
    summary:
      "Turns an `ork`-target item into a post: redacts it, adds a structured header and a fingerprint marker, and shows you the exact text before anything leaves your machine.",
    facts: [
      "Redacts secrets, emails and hostnames; absolute paths become `<project>/…`; optionally repo and workflow names.",
      "Header: Ork version, driver, model, node type, kind, count.",
      "Every post carries a hidden `<!-- ork-fingerprint: … -->` marker.",
      "Milestone 2.",
    ],
    docs: [DESIGN.feedback],
  },

  // ── Your machine ─────────────────────────────────────────────────────────
  {
    id: "jsonl",
    title: "Feedback JSONL",
    sub: "`ork feedback export` · `import`",
    zone: "machine",
    x: 1160,
    y: 360,
    status: "planned",
    pkg: null,
    summary:
      "Feedback moved as JSON lines, so a team can share it without GitHub. Publish targets are adapters, and this is one.",
    facts: [
      "Issues in the project's own repository can be a later adapter.",
      "Milestone 2.",
    ],
    docs: [DESIGN.feedback],
  },
  {
    id: "lessons",
    title: "Lessons file",
    sub: "`.ork/lessons/<workflow>.md`",
    zone: "machine",
    x: 1160,
    y: 600,
    status: "planned",
    pkg: null,
    summary:
      "The accepted lessons of one workflow, in a committed file you can review, edit and version with git.",
    facts: ["Only lessons you accepted are in it.", "Milestone 2."],
    see: [{ map: "context", node: "workflow", label: "The workflow layer" }],
    docs: [DESIGN.feedback, DESIGN.context],
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
    status: "specified",
    pkg: "runtime-claude",
    summary:
      "One of Ork's MCP tools, given to every Claude node, for the friction an agent sees that no event shows. Its description asks for only what materially got in the way, in one line and a short body.",
    facts: [
      "`feedback(kind, target, title, body, severity, evidence[])`.",
      "Kinds: `friction`, `bug`, `context-gap`, `skill`, `workflow`, `idea`. Targets: `ork`, `workflow`, `project`.",
      "Capped per session (default 3), so it stays cheap in tokens.",
      "Milestone 1d.",
    ],
    see: [
      { map: "messaging", node: "mcpTools", label: "Ork's MCP tools" },
      {
        map: "architecture",
        node: "mcpTools",
        label: "The tools in the architecture",
      },
    ],
    docs: [DESIGN.feedback, DESIGN.messaging],
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
