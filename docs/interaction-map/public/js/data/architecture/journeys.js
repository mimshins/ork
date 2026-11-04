/** @file The architecture map's journeys. */

import { CALLS, CLI, CORE, DESIGN, RUNTIME, SCHEMA, WATCH } from "../refs.js";

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
      },
    ],
  },
  {
    id: "call",
    title: "A workflow calls a workflow",
    who: "A caller · the run it calls",
    summary:
      "From a `workflow.call` node to a separate run of its own, under one budget, and what happens when the caller is stopped or resumed.",
    steps: [
      {
        from: "scheduler",
        to: "nodeTypes",
        title: "The call is activated",
        detail:
          "It takes no session slot, but it spends through its run, so none starts once the budget is spent.",
        docs: [CALLS.spec],
      },
      {
        from: "nodeTypes",
        to: "calls",
        title: "It asks the run's call port",
        detail:
          "The executor renders the workflow, project, inputs and ref. Each activation is a new run, unless the call names a `node`, which keeps one run as a conversation.",
        docs: [CALLS.node],
      },
      {
        from: "calls",
        to: "cli",
        title: "A separate `ork run` starts",
        detail:
          "Its own process, under its project's rules. An unregistered project, a project whose `calls.accept` leaves this one out, a depth past 5 or a dirty tree fails the node with the reason.",
        docs: [CALLS.start],
      },
      {
        from: "calls",
        to: "eventStore",
        title: "The store knows who called it",
        detail:
          "The run's record has `parent` and `depth`; the caller's events have `call.started`.",
      },
      {
        from: "calls",
        to: "links",
        title: "A channel to the call is linked",
        detail:
          "If a `messages` channel names the call, its nodes are linked to the called node. A message sent before then waits for it, and the call's name then stands for `<run>/<node>`.",
        docs: [CALLS.talk, CALLS.routes],
      },
      {
        from: "calls",
        title: "The call waits, as it says",
        detail:
          "`wait: run` until it has ended, `node` until that node has reported, `none` not at all. What the run spent comes back as the call's usage and counts against the caller, whose cap it started under.",
        docs: [CALLS.wait, CALLS.host],
      },
      {
        from: "scheduler",
        to: "calls",
        title: "A stop reaches down",
        detail:
          "A stop or an expired timeout on the caller stops every run it called and is still running, as a stop on the node stops that node's. A pause does not spread.",
        docs: [CALLS.tests],
      },
      {
        from: "calls",
        title: "A resume brings them back",
        detail:
          "`ork resume` on the caller takes the runs `call.started` names and its results leave open. A stopped, crashed or failed one is resumed with its finished nodes, cap, caller and `ref`; a running or succeeded one is attached to.",
        docs: [CALLS.start, CALLS.spec],
      },
    ],
  },
  {
    id: "trigger",
    title: "A trigger starts a run",
    who: "You · ork watch",
    summary:
      "From accepting a trigger in a terminal to a run started for each new thing its check reports, with no model turn until then. Not tried for real: launchd, systemd and a trigger's MCP check.",
    steps: [
      {
        from: "user",
        to: "watchCmd",
        title: "You accept it, with `ork watch --accept`",
        detail:
          "It shows what the trigger looks with and what the run does, and asks. It needs a terminal, and refuses inside a run. It takes this machine only: the hash isn't in the repository.",
        docs: [WATCH.command, WATCH.report],
      },
      {
        from: "triggerTrust",
        to: "triggerFiles",
        title: "The hash covers what could change",
        detail:
          "The trigger, the text of its workflow, the project's folder, and what its check reads. A change to any turns it off until it's accepted again.",
        docs: [WATCH.trust, WATCH.project],
      },
      {
        from: "watchCmd",
        to: "watcher",
        title: "`ork watch` takes the lock, and ticks",
        detail:
          "One per machine: the lock is a row in the store, and a second process refuses. Every 10 seconds the watcher sees what's due.",
        docs: [WATCH.lock, WATCH.command],
      },
      {
        from: "watcher",
        to: "nodeTypes",
        title: "A trigger that's due looks",
        detail:
          "Only one that's live, apart from the others, so a stuck check can't delay the rest. It takes no model turn. A failed look starts nothing, and the next goes on as usual.",
        docs: [WATCH.look, WATCH.watcher],
      },
      {
        from: "watcher",
        to: "eventStore",
        title: "The first look starts nothing",
        detail:
          "It records every key it found, so a backlog of 400 issues doesn't start 400 runs. A schedule's first look starts nothing either.",
        docs: [WATCH.triggerTests],
      },
      {
        from: "watcher",
        title: "A later look finds a new key",
        detail:
          "Each is checked against the caps first: a limit across runs, `maxRunsPerDay`, then `concurrency`. What's held waits for the next look, and `--status` says why.",
        docs: [WATCH.watcher, WATCH.triggerTests],
      },
      {
        from: "watcher",
        to: "eventStore",
        title: "The key is marked, then the run starts",
        detail:
          "In that order, so a crash can't start it twice, and a run that fails isn't started again. One that didn't start at all is unmarked and tried again, up to 3 times.",
        docs: [WATCH.store, WATCH.watcher],
      },
      {
        from: "watchCmd",
        to: "cli",
        title: "An ordinary run starts, detached",
        detail:
          "`ork run` is given the accepted file and `--expect-workflow`, so it refuses a file whose text has changed. Each input is joined to its flag, and must be one the workflow declares.",
        docs: [WATCH.start, WATCH.expect],
      },
      {
        from: "cli",
        to: "scheduler",
        title: "It runs like any other",
        detail:
          "`ork logs`, `ork stop` and the Monitor all work on it. Its `run.started` names the trigger and which inputs came from the check, so `trigger.untrusted` and `ork logs` can say so.",
        docs: [WATCH.checkTrigger, WATCH.guide],
      },
      {
        from: "server",
        to: "watcher",
        title: "The UI shows how it stands",
        detail:
          "`GET /api/triggers` feeds the Runs panel's Triggers section: what's live, when each last looked, and what's holding it. It can't accept one.",
        docs: [WATCH.route, WATCH.section],
      },
    ],
  },
];
