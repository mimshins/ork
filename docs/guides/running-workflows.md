# Running workflows

`ork run` runs a workflow on your machine and streams what happens to your
terminal. `ork ui` shows the same runs in your browser, where you can watch,
control, read and answer them too ([the browser view](./browser-view.md)).

For the full rules: [the CLI spec](../../specs/cli/running-and-runs.md),
[run control](../../specs/run-control.md) and
[the event store](../../specs/event-store.md).

## Contents

- [Running a workflow and answering it](./running-workflows/running-and-answering.md)
  - [A whole workflow](./running-workflows/running-and-answering.md#a-whole-workflow)
  - [What a session loads](./running-workflows/running-and-answering.md#what-a-session-loads)
  - [Reading the transcript](./running-workflows/running-and-answering.md#reading-the-transcript)
  - [Answering questions](./running-workflows/running-and-answering.md#answering-questions)
  - [In the background](./running-workflows/running-and-answering.md#in-the-background)
- [Attaching to a run](./running-workflows/attaching-to-a-run.md)
  - [What it shows](./running-workflows/attaching-to-a-run.md#what-it-shows)
  - [Answering](./running-workflows/attaching-to-a-run.md#answering)
  - [Leaving: Ctrl-C](./running-workflows/attaching-to-a-run.md#leaving-ctrl-c)
  - [When you start a workflow that calls others](./running-workflows/attaching-to-a-run.md#when-you-start-a-workflow-that-calls-others)
  - [Without a terminal](./running-workflows/attaching-to-a-run.md#without-a-terminal)
- [Controlling a run](./running-workflows/controlling-a-run.md)
  - [Pause, continue, stop one node](./running-workflows/controlling-a-run.md#pause-continue-stop-one-node)
  - [Follow a run, and leave it going](./running-workflows/controlling-a-run.md#follow-a-run-and-leave-it-going)
  - [Talk to a node](./running-workflows/controlling-a-run.md#talk-to-a-node)
  - [Pick a run up again](./running-workflows/controlling-a-run.md#pick-a-run-up-again)
  - [One node on its own](./running-workflows/controlling-a-run.md#one-node-on-its-own)
- [Running several runs at once](./running-workflows/several-runs.md)
  - [Slots for heavy commands](./running-workflows/several-runs.md#slots-for-heavy-commands)
  - [What waits](./running-workflows/several-runs.md#what-waits)
  - [Lower priority](./running-workflows/several-runs.md#lower-priority)
  - [Agents don't repeat your check](./running-workflows/several-runs.md#agents-dont-repeat-your-check)
  - [Seeing where the CPU went](./running-workflows/several-runs.md#seeing-where-the-cpu-went)
- [Your runs, and what they leave](./running-workflows/looking-back.md)
  - [Look back at runs](./running-workflows/looking-back.md#look-back-at-runs)
  - [What a run leaves behind](./running-workflows/looking-back.md#what-a-run-leaves-behind)
