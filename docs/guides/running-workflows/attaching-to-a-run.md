# Attaching to a run

_Part of [Running workflows](../running-workflows.md)._

A run you started in the foreground has your terminal: it prints the run, and
asks you its questions. Any other run has none: a run started with `--detach`,
and every run that a workflow calls. `ork attach` gives them one.

```sh
ork run release --detach        # prints the run id and returns
ork attach 3f2a                 # follow it here, and answer its questions
```

## Contents

- [What it shows](#what-it-shows)
- [Answering](#answering)
- [Leaving: Ctrl-C](#leaving-ctrl-c)
- [When you start a workflow that calls others](#when-you-start-a-workflow-that-calls-others)
- [Without a terminal](#without-a-terminal)

## What it shows

`ork attach <run>` (an id or a prefix of one, from any project) prints what
`ork logs` would, then each new event until the run ends. It does the same for
every run that run called, at any depth, including runs it called before you
attached. A called run's lines start with the path of the calls that led to it:

```text
plan › spec │ claude.worker
plan › spec │ ✓ pass: Drafted the spec
```

It exits with the run's status: 0 when it succeeded, 1 when it failed, crashed
or was stopped. On a run that has already ended it prints the whole transcript,
called runs included, and asks nothing. When the run ends while a run it called
is still going (a call with `wait: none`), it says so:
`↳ run 86d5fe37 still running · ork attach 86d5fe37`.

`ork logs -f` stays read-only: it prints one run and never asks.

## Answering

Every open question of the run and the runs it called is asked on the terminal,
oldest first, and each new one as it opens, as the card that
[`ork decide`](./running-and-answering.md#answering-questions) shows, with the
run and the call path named. Your answer goes to the run as `terminal`. If
someone answers first, in `ork decide`, in `ork ui` or in another terminal, the
prompt goes away and says who answered; an answer that arrives too late is
refused and never stored twice. `q` or Esc leaves a question open for later.

## Leaving: Ctrl-C

Ctrl-C in `ork attach` **detaches**; it does not stop anything. The run keeps
going, its open questions stay open, and the terminal says how to come back or
stop it:

```text
detached; run 3f2a91c0 keeps going · ork attach 3f2a91c0 · ork stop 3f2a91c0
```

This differs from `ork run` in the foreground, where Ctrl-C stops the run.

## When you start a workflow that calls others

A foreground `ork run` of a workflow that calls others, such as `start`, shows
the runs it calls the same way, and asks their questions on the same terminal,
one at a time with its own. You no longer need `ork decide` in a second terminal
to approve the plan that `start` called. Ctrl-C there still stops the run and
the runs it called, at a called run's question too. When the run ends, a called
run that is still going gets the line
`↳ run <id> still running · ork attach <id>`, and one that was stopped is
followed up to five seconds more so its end shows. `ork run --detach` and
`--json` show no called runs, and a foreground `ork resume` does not yet.

## Without a terminal

When stdin is not a terminal (a pipe, CI), `ork attach` follows and prints but
never asks: it says once `no terminal: answer with ork decide`. A foreground
`ork run` with no terminal does not answer a called run's questions either; they
wait in `ork decide` and the Decisions panel of `ork ui`.

A program or an agent inside a run cannot use `ork attach` on a terminal: it
answers as you, so it refuses there as `ork decide` does.

For the full rules: [the CLI spec](../../../specs/cli.md),
[calling workflows](../../../specs/scheduler/calls.md) and
[run control](../../../specs/run-control.md#detaching-from-a-run).
