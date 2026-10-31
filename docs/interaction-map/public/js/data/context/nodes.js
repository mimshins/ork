/**
 * @file The context map's components: the five layers from lowest to highest
 *   precedence and the owner's brief, the context compiler's steps, the parts
 *   of the session spec it produces, and the session that runs on it.
 *   Coordinates are in map units; the map is {@link SIZE} wide and tall.
 */

import { CONTEXT, DESIGN, PRACTICES, RUNTIME, SCHEMA } from "../refs.js";

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
      "What ships with Ork: the built-in practices today, and skills such as spec writing or security review, named `ork:<name>` so they never collide with anyone else's.",
    facts: [
      "Built: the caveman (terse voice) and ponytail (smallest complete change) practices, on for every Claude node and appended to its system prompt.",
      "`practices:` on `defaults` or a node turns them off or sets ponytail's level; the setting cascades down the ownership tree.",
      "Built: `ork:<name>` references. A built-in skill loads only where the workflow or a node names it, and competes at that layer.",
      "No built-in skill ships yet; naming one is a `ref.skill` error.",
    ],
    see: [
      {
        map: "architecture",
        node: "orkLayers",
        label: "Where the layers live",
      },
    ],
    docs: [
      PRACTICES.code,
      PRACTICES.tests,
      CONTEXT.skills,
      PRACTICES.spec,
      DESIGN.context,
    ],
  },
  {
    id: "user",
    title: "2 · Your user layer",
    sub: "`~/.ork/skills` · `~/.ork/context`",
    zone: "layers",
    x: 40,
    y: 240,
    status: "built",
    pkg: "core",
    summary: "Your own skills and context, for every workflow on this machine.",
    facts: [
      "Every skill in `~/.ork/skills` loads, unless a higher layer has one of the same name.",
      "`~/.ork/context/*.md` is appended in name order, under `# Your context`.",
      "Separate from `~/.claude`: Ork never loads Claude Code's user settings into a node (`settingSources` has no `user`).",
    ],
    docs: [CONTEXT.resolver, CONTEXT.files, CONTEXT.tests, DESIGN.context],
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
      "The skills are the `.claude/skills` of the node's checkout; Claude Code loads them, and Ork switches off the shadowed or left-out ones.",
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
    status: "built",
    pkg: "core",
    summary:
      "Skills and context files the workflow brings for all of its nodes, as paths relative to the workflow file.",
    facts: [
      "`layers.skills`: `./path` to a skill folder or `ork:<name>`; `layers.context`: files appended under `# Workflow context`.",
      "References stay inside the project; one that resolves to nothing is a `ref.skill` or `ref.context` error in `ork validate`.",
      "Also the workflow's accepted lessons, `.ork/lessons/<workflow>.md`, when the file exists; their token cap comes with the feedback loop.",
      "Committed with the workflow, so everyone who runs it gets the same process.",
    ],
    see: [
      { map: "feedback", node: "lessons", label: "Where lessons come from" },
    ],
    docs: [
      CONTEXT.resolver,
      CONTEXT.files,
      SCHEMA.workflow,
      SCHEMA.example,
      DESIGN.feedback,
    ],
  },
  {
    id: "nodeLayer",
    title: "5 · The node",
    sub: "`skills` · `context` · `instructions`",
    zone: "layers",
    x: 40,
    y: 600,
    status: "built",
    pkg: "core",
    summary:
      "What one node adds for itself. The most explicit and most local layer, so it wins every conflict.",
    facts: [
      "`skills` and `context` take the same references as the workflow's; the context goes last, under `# Context for this node`.",
      "`instructions` end Ork's harness text.",
      "Also sets the limits: `model`, `effort`, `maxTurns`, `budgetUsd`, `tools`, `isolation`.",
    ],
    docs: [CONTEXT.resolver, CONTEXT.tests, SCHEMA.nodes],
  },
  {
    id: "brief",
    title: "The owner's brief",
    sub: "context packet · not a transcript",
    zone: "layers",
    x: 40,
    y: 720,
    status: "partial",
    pkg: null,
    summary:
      "What the node is asked to do now: its rendered `prompt`, or its owner's `delegate` brief, plus the artifacts it needs, by path. Never the owner's full transcript.",
    facts: [
      "Templates such as `{{nodes.spec.output.artifacts.spec}}` render to a path, not to the file's content.",
      "Built: a delegated brief follows the node's own prompt as `## Task from <owner>`.",
      "Constraints from the owner (scope, files, deadline) travel with it.",
    ],
    docs: [RUNTIME.plan, DESIGN.concepts, DESIGN.context],
  },

  // ── Context compiler ─────────────────────────────────────────────────────
  {
    id: "agentCatalog",
    title: "Agent catalog",
    sub: "who fills each node",
    zone: "compiler",
    x: 320,
    y: 240,
    status: "built",
    pkg: "core",
    summary:
      "A node with `agent: <name>` takes that agent's settings where it sets none, and its role as a section of the system prompt. Agents are filled in when the workflow compiles.",
    facts: [
      "Sources, low to high: `~/.ork/agents`, the project's `.ai/agents`, `.opencode/agents`, `.claude/agents`, then `.ork/agents`, then the workflow's `agents:`.",
      "An agent is a portable `<name>.md` plus an optional `<name>.agent.yaml` with Ork's settings.",
      "Linked folders are followed; a file reached twice counts once. `node.started` records the agent and a hash.",
      "`ork agents list | show | add | rm`; Ork writes only `.ork/agents` and `~/.ork/agents`.",
    ],
    docs: [
      CONTEXT.agentCatalog,
      CONTEXT.agentApply,
      CONTEXT.agentTests,
      CONTEXT.agentsCli,
      DESIGN.context,
    ],
  },
  {
    id: "agentsRule",
    title: "AGENTS.md rule",
    sub: "left to Claude Code",
    zone: "compiler",
    x: 320,
    y: 360,
    status: "built",
    pkg: "integrations",
    summary:
      "Claude Code reads `AGENTS.md` itself when there is no `CLAUDE.md` or `CLAUDE.local.md`, in every session from v2.1.281. So Ork appends nothing, and the file is never loaded twice.",
    facts: [
      "`ork doctor` warns when your `claude` is older than 2.1.281.",
      "With a `CLAUDE.md` (for example one that imports `@AGENTS.md`), Claude Code reads that instead.",
      "`project.instructions: ignore` keeps it out too.",
    ],
    docs: [CONTEXT.version, DESIGN.context],
  },
  {
    id: "explain",
    title: "ork context explain",
    sub: "the resolved stack, per node",
    zone: "compiler",
    x: 320,
    y: 480,
    status: "built",
    pkg: "cli",
    summary:
      "Prints what one node will see: its project instructions, each skill with the layer it came from and whether it is live, shadowed or off, its context files and practices, and estimated tokens.",
    facts: [
      "`ork context explain <wf> <node>`, or `--json`; it plans the session without writing anything.",
      "Tokens are estimates, about four characters each; a skill's count is what it costs when used.",
      "The UI's context inspector (milestone 2) will show the same.",
    ],
    docs: [CONTEXT.explain, CONTEXT.explainTests, DESIGN.context, DESIGN.cli],
  },
  {
    id: "resolver",
    title: "Layer resolver",
    sub: "precedence · shadowing",
    zone: "compiler",
    x: 320,
    y: 600,
    status: "built",
    pkg: "core",
    summary:
      "Merges the layers: for a skill name that appears in more than one, the highest layer wins and the others do not load.",
    facts: [
      "Precedence, low to high: user, project, workflow, node. Rule: more explicit and more local wins.",
      "A project skill shadowed by a higher layer, or left out by `project.skills`, is switched off in the session.",
      "The winners outside the project go into the node's plugin.",
      "`ork validate` and `ork run` report references that resolve to nothing (`ref.skill`, `ref.context`).",
    ],
    docs: [CONTEXT.resolver, CONTEXT.skills, CONTEXT.tests, DESIGN.context],
  },
  {
    id: "assembler",
    title: "Prompt assembler",
    sub: "stable prefix first",
    zone: "compiler",
    x: 320,
    y: 720,
    status: "partial",
    pkg: "core",
    summary:
      "Orders everything so the prompt cache works: what is the same for many nodes goes first, the task itself last.",
    facts: [
      "Built, after Claude Code's own prompt: the practices, your context, the workflow's context, Ork's harness text, then the node's context.",
      "Suffix: the brief, as the first user message.",
      "Specified: leaders, which live long, ask for the 1-hour cache.",
    ],
    docs: [CONTEXT.session, RUNTIME.plan, DESIGN.context],
  },

  // ── Session spec ─────────────────────────────────────────────────────────
  {
    id: "sysprompt",
    title: "System prompt addition",
    sub: "appended to `claude_code`",
    zone: "spec",
    x: 600,
    y: 360,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "What Ork appends to Claude Code's own system prompt: the practices, the context files of each layer, and Ork's harness text with the node's instructions.",
    facts: [
      "SDK: `systemPrompt: { type: 'preset', preset: 'claude_code', append }`.",
      "CLI: `--append-system-prompt`.",
    ],
    docs: [RUNTIME.sdk, RUNTIME.cli, DESIGN.runtime],
  },
  {
    id: "settings",
    title: "Claude Code settings",
    sub: "sources · `skillOverrides`",
    zone: "spec",
    x: 600,
    y: 480,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "Which of Claude Code's own setting sources load, and extra settings for the session, so the project layer works natively and shadowed skills stay off.",
    facts: [
      "`settingSources: ['project', 'local']`, never `user`.",
      '`skillOverrides: { <name>: "off" }` hides each shadowed or left-out project skill; a plugin\'s `ork:<name>` is untouched.',
      "`project.instructions: ignore` adds `claudeMdExcludes` for the checkout and stops Claude Code reading `AGENTS.md`.",
      "SDK: `settings`; CLI: `--settings`.",
    ],
    docs: [CONTEXT.session, RUNTIME.sdk, RUNTIME.cli, DESIGN.context],
  },
  {
    id: "plugin",
    title: "Per-run plugin",
    sub: "`ork:*` skills, one per node",
    zone: "spec",
    x: 600,
    y: 600,
    status: "built",
    pkg: "core",
    summary:
      "A local plugin written for each node of the run, holding the winning skills from the user, workflow and node layers.",
    facts: [
      "In `.ork/runs/<run>/plugins/<node>/`, named `ork`, so its skills load as `ork:<name>` and never collide with the project's.",
      "SDK: `plugins: [{ type: 'local', path }]`; CLI: `--plugin-dir`.",
    ],
    docs: [CONTEXT.session, CONTEXT.tests, DESIGN.context],
  },
  {
    id: "briefMsg",
    title: "Task brief",
    sub: "the first user message",
    zone: "spec",
    x: 600,
    y: 720,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "The brief, sent as the session's first user message, after the cached prefix.",
    facts: [
      "A resumed leader gets only what is new: the round's input, or its new task.",
      "Later messages from the bus (milestone 1d) will arrive between turns.",
    ],
    docs: [RUNTIME.plan, DESIGN.context],
  },
  {
    id: "limits",
    title: "Limits and tools",
    sub: "model · turns · budget · allow",
    zone: "spec",
    x: 600,
    y: 840,
    status: "built",
    pkg: "runtime-claude",
    summary:
      "The node's model and effort, turn and budget limits, and its tool rules, from the node or the workflow's `defaults`.",
    facts: [
      "Built: `model`, `effort`, `maxTurns`, `budgetUsd` (capped by what is left of the run's) and `tools` go into the session spec, from the node or `defaults`.",
      "A session out of turns or budget ends without a report: a `fail` for its edges, or for the leader that delegated it.",
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
    status: "built",
    pkg: "core",
    summary:
      "What the node hands back to its owner: a status, a short summary, artifact paths, its branch, and its usage. The owner reads the summary, not the session.",
    facts: [
      "The session's structured output, checked against a JSON Schema; not a tool call.",
      "Structured fields from `output.schema`, such as `verdict`.",
      "Usage from the final result: cost, tokens, turns and time.",
    ],
    docs: [RUNTIME.report, DESIGN.runtime, DESIGN.concepts],
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
