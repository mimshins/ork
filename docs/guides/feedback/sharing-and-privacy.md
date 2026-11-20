# Sharing feedback, the browser, and what stays on your machine

_Part of [Feedback from your runs](../feedback.md)._

## Sharing feedback about Ork

When an item is about Ork itself (a tool that failed, a bug in the engine), you
can share it with Ork's maintainers:

```sh
ork feedback publish 0893f
```

Ork takes out what shouldn't leave your machine: secrets, your projects' paths
(`<project>/…`) and your home folder (`~`), emails, host names and IP addresses;
`--hide-names` takes out your workflows' and folders' names too. It adds what
the problem was seen with (Ork's version, the driver, model and node type) and
how often, and looks, with your own `gh`, for a thread about the same item in
the "Agent feedback" category of Ork's Discussions. Then it shows you exactly
what it would post (a new thread, or a "+1" on the one there) and asks. Nothing
is sent unless you say `y`, and there is no flag to skip the question. It needs
a terminal, and `gh auth login` done by you.

To share feedback another way, between your machines or a team, move it as JSON
lines:

```sh
ork feedback export -o feedback.jsonl     # add --all for dismissed items too
ork feedback import feedback.jsonl        # skips what's already here
```

## In the browser

`ork ui`'s **Feedback** panel does the same, beside your runs. It lists every
item (Status shows the dismissed ones too, About narrows to `ork`, `workflow` or
`project`), and an item you choose shows its facts, its records newest first
with the way to each run, and what you can do with it; a button that doesn't
apply says why.

- **Add lesson…** shows the lessons file and how full it is before anything is
  written, and asks which workflow when there's more than one.
- **Propose fix…** names the project, asks before it starts the run (with a
  choice of driver) and takes you to it in the Monitor; keep or discard it in
  Decisions.
- **Publish…** shows exactly what would be posted, as text, and posts only when
  you press **Post**. If what it would send changed since you read it, it shows
  you the new text instead.

To note how a run or node went, use **Note…** in the Monitor.

## What stays on your machine

Feedback lives in `~/.ork/state.db` with your runs, with secrets and your `env:`
values (for a typed note, as the workflow file reads now) masked before anything
is written. Nothing is sent unless you publish an item, then only what you read
and confirmed ([where Ork keeps things](../where-ork-keeps-things.md)). Full
rules: [feedback](../../../specs/feedback.md).
