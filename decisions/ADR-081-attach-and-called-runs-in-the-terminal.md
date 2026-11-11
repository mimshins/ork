# ADR-081 — `ork attach`, and a foreground caller that shows and asks its called runs

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** cli
- **RFC:** waived — the maintainer decided this directly in a design review
- **Amends:** [ADR-071](./ADR-071-workflows-by-stage.md)

## Context

Only a run started with `ork run` in the foreground has a terminal that shows
its events and asks its questions. Every other run has none. A detached run
(`--detach`) can be followed with `ork logs -f`, which prints its `? asks:`
lines but cannot answer them. A `workflow.call` starts the called workflow as a
background run, and the caller only waits on the store.

Ork's own `start` run showed it: a foreground `ork run start` printed
`plan │ ↳ started plan as run 86d5fe37` and nothing more, while that run's
approval gate waited in `ork decide` or the Decisions panel of `ork ui` (gap
L59, since removed). ADR-071 had rejected forwarding called runs' questions to
the caller's terminal for now, on the ground that `ork decide` and the Decisions
panel already reach them. In practice the person who started the chain was
looking at the one terminal that could not answer.

## Decision

- **`ork attach <run>` gives any run a terminal like a foreground one.** It
  replays the run's transcript, follows it live, follows every run it called at
  any depth, and asks all their open decisions on the terminal, oldest first,
  then each new one as it opens. Each called run's lines carry its call path
  before the node chip (`plan › spec`).
- **A foreground `ork run` does the same for every run it calls,** with the same
  code: `followRunTree` in core follows a run and the runs it called from their
  `call.started` events, `askStored` asks one stored decision on a terminal
  (`ork decide` uses it too), and `attachRun` joins them. `--detach`, `--json`
  and a foreground `ork resume` change nothing.
- **Answers are stored as `answeredBy: terminal`.** There is no new `AnsweredBy`
  value, no store, event or runtime change: answers go through the existing
  `answerDecision`, and the store's first answer still wins. A prompt is
  withdrawn when its decision is answered or withdrawn elsewhere (`ork decide`,
  the UI, another terminal), and the line says who answered.
- **Ctrl-C in `ork attach` detaches.** The run keeps going, no stop is
  requested, and its open decisions stay open; it prints
  `detached; run <id> keeps going · ork attach <id> · ork stop <id>` and
  exits 0. In a foreground caller Ctrl-C keeps its meaning everywhere, at a
  called run's prompt too: the caller is interrupted and stops what it called. A
  called run the caller stopped is followed for up to 5 seconds more, so its end
  shows.
- **No terminal, nothing is asked.** With stdin not a TTY, `ork attach` follows
  and says once to answer with `ork decide`. A foreground caller without a
  terminal never answers a called run's decision on its own: the recommended
  option fallback is for the caller's own questions only.
- **`ork logs -f` stays read-only.**
- **`ork attach` refuses on a terminal from inside a run,** as `ork decide` does
  ([ADR-047](./ADR-047-script-identity-env-json.md)): a program or an agent in a
  run cannot answer as the user with it. It may still follow, with no terminal.

## Options considered

- **`ork attach` plus a foreground caller that attaches (chosen).** One piece of
  code serves both, and Ork's own `start` → `plan` → `build` chain can be
  watched and answered from the terminal that started it.
- **`ork logs -f` answers on a terminal, with `--no-answer`.** Rejected: a
  command named for reading would write by default, and a pipe or a script that
  follows a log would need the opt-out.
- **Both of the above.** Rejected: two ways to do one thing.
- **Show called runs only, and answer elsewhere.** Rejected: the person is at
  the terminal and the question is on the screen they read.
- **Record the gap only.** Rejected: the gap is in the way Ork builds itself.
- **Ctrl-C in attach: detach (chosen), stop the run, or ask which.** A terminal
  that only looks at a run should not end it by accident; `ork stop` is one
  command away, and a foreground caller still stops because it owns the run.

## Rationale

A person's terminal is where questions are expected. Following is read-only and
answering already has a guarded path in `answerDecision`, so a terminal that
follows a tree can ask for it without a change to the runtime. A detached run
also gets a way back to a terminal.

## Consequences

- **The name.** An "attached project" already means a project kept outside its
  repository (`ork register`). The help text says "follow a run" so the two do
  not read alike. The maintainer chose the name knowing this.
- **Several answerers.** Two attached terminals, a run's own terminal,
  `ork decide` and the UI can all prompt at once; first answer wins, and a late
  one is refused with `answerDecision`'s message and never stored twice.
- **Noise and replay.** A deep chain prints a lot in one terminal, readable by
  its prefixes, and attaching late replays the whole run, as `ork logs` does.
  `ork logs <run>` stays for one run; `--tail`, `--node` and `--json` for attach
  are not built.
- **A foreground `ork resume` does not show its called runs.** An adopted call
  emits no new `call.started` (a gap, [L262](../specs/gaps.md)).
- ADR-071's consequence that a called run has no terminal no longer holds for a
  foreground caller; for a detached one it still does.
