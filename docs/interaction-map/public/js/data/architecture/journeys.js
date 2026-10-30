/** @file The architecture map's journeys. */

import { CLI, CORE, DESIGN, RUNTIME, SCHEMA } from "../refs.js";

/** @typedef {import("../types.js").Journey} Journey */

/** @type {ReadonlyArray<Journey>} */
export const JOURNEYS = [
  {
    id: "validate",
    title: "Validate a workflow file",
    who: "You",
    summary:
      "From `ork validate` to a list of diagnostics, each with a file, line and column. Every step is built.",
    steps: [
      {
        from: "user",
        to: "cli",
        title: "You run `ork validate`",
        detail:
          "Pointing at a file such as `.ork/workflows/software-factory.ork.yaml`.",
        docs: [CLI.validate, DESIGN.cli],
      },
      {
        from: "cli",
        to: "compiler",
        title: "The CLI hands the file to the compiler",
        detail:
          "Validation is the same code a run uses, so a file that validates is a file that compiles.",
      },
      {
        from: "compiler",
        to: "schema",
        title: "The schema parses the YAML",
        detail:
          "YAML syntax errors stop here with their line. Otherwise the Zod model checks every node against its type; an unknown key or node type points at its own line.",
        docs: [SCHEMA.yaml, SCHEMA.tests],
      },
      {
        from: "schema",
        to: "workflowFiles",
        title: "Positions come from the source text",
        detail:
          "Each diagnostic's path inside the workflow is mapped back to a line and column in the file.",
        docs: [SCHEMA.yaml],
      },
      {
        from: "compiler",
        title: "The compiler checks the graph",
        detail:
          "Edges are expanded from shorthand; parents, message channels and template references must resolve; every cycle needs `maxRounds`; at least one entry node must exist.",
        docs: [CORE.compile, CORE.flow, CORE.tests],
      },
      {
        from: "compiler",
        to: "cli",
        title: "The CLI prints the diagnostics",
        detail:
          "Errors and warnings with file, line and column; the exit code is non-zero when there is an error.",
      },
    ],
  },
  {
    id: "one-node",
    title: "Run one Claude node",
    who: "You · a Claude session",
    summary:
      "One `claude.worker` from start to report: its context is compiled, its worktree created, its session started and fed, and its report routed on.",
    steps: [
      {
        from: "cli",
        to: "scheduler",
        title: "`ork run` starts the run",
        detail:
          "The graph is compiled and the run's first event is written; entry nodes are ready to start.",
        docs: [DESIGN.cli],
      },
      {
        from: "scheduler",
        to: "contextCompiler",
        title: "The node's context is compiled",
        detail:
          "The layers are resolved by precedence, the owner's brief is rendered from its templates, and the stable parts are put first.",
        docs: [DESIGN.context],
      },
      {
        from: "scheduler",
        to: "worktreeMgr",
        title: "It gets its own worktree",
        detail:
          "`isolation: worktree` is the default: a new branch from the owner's, checked out beside the clone in `../<clone>-worktrees/`, with the local agent files copied in.",
      },
      {
        from: "scheduler",
        to: "runtimeAdapter",
        title: "Its session starts",
        detail:
          "The adapter picks the node's driver and passes the session spec: cwd, model, budget, tools, plugin directory.",
        docs: [DESIGN.runtime],
      },
      {
        from: "sdkDriver",
        to: "session",
        title: "Claude Code runs the loop",
        detail:
          "The SDK starts the agent loop with the brief as the first user message.",
      },
      {
        from: "session",
        to: "model",
        title: "The model works through the task",
        detail:
          "Turn by turn, with tool calls in the worktree; the cached prefix keeps repeated context cheap.",
        status: "specified",
      },
      {
        from: "session",
        to: "runtimeAdapter",
        title: "It ends with its report",
        detail:
          "Structured output against the node's report schema: status, a short summary, artifact paths, its branch and the `output.schema` fields. Large outputs are artifacts, passed by path.",
        docs: [RUNTIME.report],
      },
      {
        from: "runtimeAdapter",
        to: "scheduler",
        title: "The report is routed",
        detail:
          "The node is done; the scheduler follows every outgoing edge whose `when:` holds for its output.",
      },
      {
        from: "scheduler",
        to: "eventStore",
        title: "Everything was logged",
        detail:
          "Start, tool calls, usage and the report are in the run's events, ready for `ork logs` and the UI.",
        status: "specified",
      },
    ],
  },
];
