/**
 * @file The context map's components: the five layers from lowest to highest
 *   precedence and the owner's brief, the context compiler's steps, the parts
 *   of the session spec it produces, and the session that runs on it.
 *   Coordinates are in map units; the map is {@link SIZE} wide and tall.
 */

import { DESIGN, PRACTICES, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").MapNode} MapNode */
/** @typedef {import("../types.js").Zone} Zone */
/** @typedef {import("../types.js").Group} Group */

/** The map's extent, in map units. */
export const SIZE = { w: 1420, h: 980 };

/**
 * The columns, left to right.
 *
 * @type {ReadonlyArray<Zone>}
 */
export const ZONES = [
  { id: "layers", label: "Layers · low to high", x: 20, w: 260, tone: "slate" },
  { id: "compiler", label: "Context compiler", x: 300, w: 260, tone: "orange" },
  { id: "spec", label: "Session spec", x: 580, w: 260, tone: "teal" },
  {
    id: "session",
    label: "The session and after",
    x: 860,
    w: 540,
    tone: "amber",
  },
];

/**
 * Outlined boxes that group components running together.
 *
 * @type {ReadonlyArray<Group>}
 */
export const GROUPS = [];

/** @type {ReadonlyArray<MapNode>} */
export const NODES = [
  // ── Layers ───────────────────────────────────────────────────────────────
  {
    id: "builtins",
    title: "1 · Ork built-ins",
    sub: "skills shipped as `ork:*`",
    zone: "layers",
    x: 40,
    y: 120,
    status: "partial",
    pkg: "core",
    summary:
      "What ships with Ork: the built-in practices today, and skills such as spec writing or security review, namespaced `ork:` so they never collide with anyone else's.",
    facts: [
      "Built: the caveman (terse voice) and ponytail (smallest complete change) practices, on for every Claude node and appended to its system prompt.",
      "`practices:` on `defaults` or a node turns them off or sets ponytail's level; the setting cascades down the ownership tree.",
      "The lowest layer: a project skill with the same name replaces it.",
      "Specified: `ork:*` skills, delivered through the per-run plugin.",
    ],
    see: [
      {
        map: "architecture",
        node: "orkLayers",
        label: "Where the layers live",
      },
    ],
    docs: [PRACTICES.code, PRACTICES.tests, PRACTICES.spec, DESIGN.context],
  },
  {
    id: "user",
    title: "2 · Your user layer",
    sub: "`~/.ork/skills` · `~/.ork/context`",
    zone: "layers",
    x: 40,
    y: 240,
    status: "specified",
    pkg: null,
    summary: "Your own skills and context, for every workflow on this machine.",
    facts: [
      "Separate from `~/.claude`: Ork never loads Claude Code's user settings into a node (`settingSources` has no `user`).",
    ],
    docs: [DESIGN.context],
  },
  {
    id: "project",
    title: "3 · The project",
    sub: "CLAUDE.md · AGENTS.md",
    zone: "layers",
    x: 40,
    y: 360,
    status: "external",
    pkg: null,
    summary:
      "The repo's own instructions and skills, loaded by Claude Code itself so the project works the way it always does. The workflow decides whether to inherit, ignore or allow-list them.",
    facts: [
      "`layers.project.instructions`: `inherit` (default) or `ignore`.",
      "`layers.project.skills`: `inherit` (default), `ignore`, or `{ allow: [...] }`.",
      "`.claude/agents` are available to the session like any Claude Code project.",
    ],
    see: [
      { map: "architecture", node: "projectFiles", label: "The project files" },
    ],
    docs: [DESIGN.context, SCHEMA.workflow],
  },
  {
    id: "workflow",
    title: "4 · The workflow",
    sub: "`layers.skills` · `layers.context`",
    zone: "layers",
    x: 40,
    y: 480,
    status: "partial",
    pkg: null,
    summary:
      "Skills and context files the workflow brings for all of its nodes, as paths relative to the workflow file.",
    facts: [
      "The schema accepts `layers:` today; nothing reads it yet.",
      "Committed with the workflow, so everyone who runs it gets the same process.",
      "Also the workflow's accepted lessons, `.ork/lessons/<workflow>.md`, up to 1,500 tokens (milestone 2).",
    ],
    see: [
      { map: "feedback", node: "lessons", label: "Where lessons come from" },
    ],
    docs: [SCHEMA.workflow, SCHEMA.example, DESIGN.feedback],
  },
  {
    id: "nodeLayer",
    title: "5 · The node",
    sub: "`skills` · `context` · `instructions`",
    zone: "layers",
    x: 40,
    y: 600,
    status: "partial",
    pkg: null,
    summary:
      "What one node adds for itself. The most explicit and most local layer, so it wins every conflict.",
    facts: [
      "The schema accepts these fields today; nothing reads them yet.",
      "Also sets the limits: `model`, `maxTurns`, `budgetUsd`, `tools`, `isolation`.",
    ],
    docs: [SCHEMA.nodes],
  },
  {
    id: "brief",
    title: "The owner's brief",
    sub: "context packet · not a transcript",
    zone: "layers",
    x: 40,
    y: 720,
    status: "specified",
    pkg: null,
    summary:
      "What the node is asked to do now: its rendered `prompt`, or its owner's `delegate` brief, plus the artifacts it needs, by path. Never the owner's full transcript.",
    facts: [
      "Templates such as `{{nodes.spec.output.artifacts.spec}}` render to a path, not to the file's content.",
      "Constraints from the owner (scope, files, deadline) travel with it.",
    ],
    docs: [DESIGN.concepts, DESIGN.context],
  },

  // ── Context compiler ─────────────────────────────────────────────────────
  {
    id: "agentsRule",
    title: "AGENTS.md rule",
    sub: "add it only when no CLAUDE.md",
    zone: "compiler",
    x: 320,
    y: 360,
    status: "specified",
    pkg: "core",
    summary:
      "Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`, and the SDK may not read it at all. So Ork appends `AGENTS.md` itself in exactly that case, and never otherwise.",
    facts: [
      "With a `CLAUDE.md` (for example one that imports `@AGENTS.md`), Ork adds nothing.",
      "Only once per session, so it is never loaded twice.",
    ],
    docs: [DESIGN.context],
  },
  {
    id: "explain",
    title: "ork context explain",
    sub: "the resolved stack, per node",
    zone: "compiler",
    x: 320,
    y: 480,
    status: "specified",
    pkg: "cli",
    summary:
      "Prints what one node will see: each file, the layer it came from, what it shadowed, and an estimate of its tokens.",
    facts: [
      "`ork context explain <wf> <node>`; the UI's context inspector shows the same.",
    ],
    docs: [DESIGN.context, DESIGN.cli],
  },
  {
    id: "resolver",
    title: "Layer resolver",
    sub: "precedence · shadowing",
    zone: "compiler",
    x: 320,
    y: 600,
    status: "specified",
    pkg: "core",
    summary:
      "Merges the five layers: for a skill name or an instruction that appears in more than one, the highest layer wins and the others are dropped.",
    facts: [
      "Rule: more explicit and more local wins.",
      "A project skill shadowed by a higher layer is left out of the session's skill allow-list.",
      "Writes the Ork, user, workflow and node skills into a per-run local plugin.",
    ],
    docs: [DESIGN.context],
  },
  {
    id: "assembler",
    title: "Prompt assembler",
    sub: "stable prefix first",
    zone: "compiler",
    x: 320,
    y: 720,
    status: "specified",
    pkg: "core",
    summary:
      "Orders everything so the prompt cache works: what is the same for every task goes first, the task itself last.",
    facts: [
      "Prefix: system preset, skills, project docs, workflow context, node instructions.",
      "Suffix: the brief.",
      "Leaders, which live long, ask for the 1-hour cache.",
    ],
    docs: [DESIGN.context],
  },

  // ── Session spec ─────────────────────────────────────────────────────────
  {
    id: "sysprompt",
    title: "System prompt addition",
    sub: "appended to `claude_code`",
    zone: "spec",
    x: 600,
    y: 360,
    status: "specified",
    pkg: "runtime-claude",
    summary:
      "What Ork appends to Claude Code's own system prompt: workflow context, node instructions, and `AGENTS.md` when the rule says so.",
    facts: [
      "SDK: `systemPrompt: { type: 'preset', preset: 'claude_code', append }`.",
      "CLI: `--append-system-prompt-file`.",
    ],
    docs: [DESIGN.runtime],
  },
  {
    id: "settings",
    title: "Claude Code settings",
    sub: "project, local · skill allow-list",
    zone: "spec",
    x: 600,
    y: 480,
    status: "specified",
    pkg: "runtime-claude",
    summary:
      "Which of Claude Code's own setting sources load, and which skills are enabled, so the project layer works natively and shadowed skills stay off.",
    facts: [
      "`settingSources: ['project', 'local']`, never `user`.",
      "The skill allow-list removes shadowed and ignored project skills.",
    ],
    docs: [DESIGN.context, DESIGN.runtime],
  },
  {
    id: "plugin",
    title: "Per-run plugin",
    sub: "Ork, user, workflow, node skills",
    zone: "spec",
    x: 600,
    y: 600,
    status: "specified",
    pkg: "runtime-claude",
    summary:
      "A local plugin directory generated for the run, holding every skill that comes from above or beside the project.",
    facts: [
      "Plugin skills are namespaced, so they never collide with project skills at run time.",
      "Passed with `plugins`.",
    ],
    docs: [DESIGN.context],
  },
  {
    id: "briefMsg",
    title: "Task brief",
    sub: "the first user message",
    zone: "spec",
    x: 600,
    y: 720,
    status: "specified",
    pkg: "runtime-claude",
    summary:
      "The brief, sent as the session's first user message, after the cached prefix.",
    facts: ["Later messages from the bus arrive between turns, after it."],
    docs: [DESIGN.context],
  },
  {
    id: "limits",
    title: "Limits and tools",
    sub: "model · turns · budget · allow",
    zone: "spec",
    x: 600,
    y: 840,
    status: "partial",
    pkg: "runtime-claude",
    summary:
      "The node's model, turn and budget limits and its tool rules, from the node or the workflow's `defaults`.",
    facts: [
      "The schema accepts `model`, `maxTurns`, `budgetUsd`, `tools` and `defaults` today; nothing applies them yet.",
      "A node at its limit escalates to its owner.",
      "`readonly` adds the write tools to the deny list.",
    ],
    docs: [SCHEMA.nodes, DESIGN.context],
  },

  // ── The session and after ────────────────────────────────────────────────
  {
    id: "session",
    title: "Claude session",
    sub: "one node · one task",
    zone: "session",
    x: 880,
    y: 600,
    status: "external",
    pkg: null,
    summary:
      "Claude Code running on exactly this spec. Workers start fresh for every task; only leaders keep a session across tasks.",
    facts: [
      "Loads the project's files itself from the allowed setting sources.",
    ],
    see: [
      {
        map: "architecture",
        node: "session",
        label: "The session in the architecture",
      },
    ],
    docs: [DESIGN.runtime],
  },
  {
    id: "model",
    title: "Claude API",
    sub: "cached prefix · per-node model",
    zone: "session",
    x: 1160,
    y: 600,
    status: "external",
    pkg: null,
    summary:
      "The model the node runs on. A stable prefix means repeated context is read from the cache, not paid for again.",
    facts: ["Caching is automatic, 5-minute TTL by default."],
    docs: [DESIGN.context],
  },
  {
    id: "report",
    title: "Report",
    sub: "status · summary · artifacts",
    zone: "session",
    x: 880,
    y: 840,
    status: "specified",
    pkg: null,
    summary:
      "What the node hands back to its owner: a status, a short summary, artifact paths, its branch, and its usage. The owner reads the summary, not the session.",
    facts: [
      "Usage includes sub-agents' tokens.",
      "Structured fields from `output.schema`, such as `verdict`.",
    ],
    docs: [DESIGN.concepts],
  },
  {
    id: "artifacts",
    title: "Artifact store",
    sub: "`.ork/runs/<id>/` · by path",
    zone: "session",
    x: 1160,
    y: 840,
    status: "specified",
    pkg: null,
    summary:
      "Where outputs over a size threshold go. Other nodes get a path and read the file only if they need it.",
    facts: ["Keeps big outputs out of every downstream prompt."],
    docs: [DESIGN.context],
  },
];
