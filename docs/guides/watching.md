# Watching a source

Sometimes a workflow should wait for something outside it: a CI job finishing, a
review thread appearing, a new issue being filed. Ork does that with a small
program you already know how to write, called a look. It takes no model turn, so
hours of waiting cost nothing, and the first session starts after something
happened.

There are two ways to use a look:

- **Inside a run:** the run exists, and pauses at a step until a source says
  something. CI failed, so fix it and watch again. That's `watch:`.
- **To start a run:** no run exists yet. A new issue was filed, so triage it.
  That's `ork watch`, with triggers.

## Waiting inside a run

Add `watch:` to a tool or MCP node. Here's
[`examples/wait-for-ci.ork.yaml`](../../examples/wait-for-ci.ork.yaml), cut
down:

```yaml
ci:
  type: tool.gh
  command: pr view {{inputs.pr}} --json statusCheckRollup --jq '...'
  output:
    format: json
    schema: { result: [pending, passed, failed] }
  watch:
    every: 30s
    until: json.result != 'pending'
    timeout: 2h
```

- `every` is how long to wait between looks, at least 5 seconds.
- `until` says when to stop looking. In the builder you choose it from what the
  node declares, and `ork validate` refuses one that can't hold, so it can't
  wait for a value or a field that never comes.
- `timeout` is how long to go on. After that the node fails, and an edge with
  `when: "!ok"` can catch it.

The last look is the node's output, so its edges read it as usual.

**Have your program say "not yet" rather than fail.** A non-zero exit means the
look itself went wrong, as a network error does, so Ork tries again and gives up
after 3 in a row. Set `misses:` to change that. A look that succeeds and says
`pending` can go on for as long as `timeout` allows.

**To tell what's new,** a tool's program gets `$ORK_STATE`, a file that stays
between looks. It's yours to create:

```sh
seen=$(cat "$ORK_STATE" 2>/dev/null || echo 0)
now=$(gh api repos/o/r/pulls/12/comments --jq length)
echo "$now" > "$ORK_STATE"
[ "$now" -gt "$seen" ] && echo '{"state":"new"}' || echo '{"state":"none"}'
```

**While it waits:** `ork pause` holds it between looks, `ork stop` ends it, and
the Monitor shows what it's waiting for. The time between looks doesn't count
against `limits.timeout` unless something else in the run is working, and it
uses no session slot.

## Starting a run when something happens

Put triggers in `.ork/triggers.yaml`, in a project you've set up with `ork init`
or `ork register`:

```yaml
schemaVersion: 1
triggers:
  new-issue:
    every: 5m
    check:
      type: tool.gh
      command:
        issue list --search created:>=2026-11-04 --limit 30 --json number --jq
        '{events:[.[] | {key:(.number|tostring),
        inputs:{issue:(.number|tostring)}}]}'
    run: triage
```

Filter by the day you set it up, as this does. The first look only records
what's on the list, so with a backlog longer than `--limit`, closing one issue
would slide an old one onto the list, where it looks new.

A check reports a list. Each `key` not seen before starts one run of the
workflow, with those `inputs`. With no `check`, a trigger starts a run every
time. `every` is at least a minute, as each look uses your quota with that
source.

Then:

```sh
ork validate              # checks your workflows and triggers
ork watch --accept        # asks about each new or changed trigger
ork watch                 # or: ork watch --detach
ork watch --status        # what's live, and when each last looked
ork watch --stop
```

**What Ork guards, so you don't have to:**

- The first look starts nothing, so what's on the list today doesn't start a run
  each. After that, anything new on the list starts, up to the daily cap,
  however long `ork watch` was stopped or the trigger was off.
- Each key starts once. A run that fails isn't started again on its own. A key
  whose run won't start doesn't hold up the others, and is left alone after 3
  tries; `ork watch`'s output says so.
- The workflow must have `limits.budgetUsd`, and each trigger has
  `maxRunsPerDay` (default 10). [Limits across runs](./models-and-budgets.md)
  hold it until they reset.
- One run at a time by default. A new key waits for the next look.

**Accepting.** A trigger runs code with nobody there, and pulling a branch could
change it, so `ork watch` runs only what you accepted on this machine. These
turn it off until you accept it again:

- a change to the trigger, or to the workflow it starts
- a change to what its check runs: the files its command names, or `.mcp.json`
- the project moving to another folder

`ork watch --accept` says whether each is new or changed, and shows what it
looks with and the workflow's nodes. It can't show you what changed, so read the
diff before you say yes.

**It doesn't cover everything a run reads.** A change to a skill, an agent in
its own file, a script the workflow calls, a workflow it calls or `project.yaml`
doesn't turn it off. If a stranger can get a branch onto this checkout, pulling
it can still change what runs.

Accepting takes a terminal, so a browser tab can't do it, and a program in a run
is refused. That stops accidents, but it isn't a wall: a program determined to,
with a terminal of its own, could answer the question.

### Don't let a stranger talk to a session

Anyone can file an issue, and its title can reach a prompt. Ork marks what a
check reports as untrusted, and `ork validate` warns (`trigger.untrusted`) when
a prompt reads it on a session that can do more than `Read`, `Grep` and `Glob`.
The safe pattern is to pass numbers, not text, and let the session read the rest
with narrow tools:

```yaml
triage:
  type: claude.worker
  prompt: Triage issue {{inputs.issue}}, and only say what it's about.
  tools: { only: [Read] }
```

### Keeping it alive

`ork watch` is yours to start and stop, and Ork installs nothing. To have it
survive a restart, give it to your system. A service doesn't get your shell's
`PATH`, so name the folders holding `node`, and any tool your checks call, such
as `gh`. These restart it only if it fails, so `ork watch --stop` stays stopped.

On macOS, as `~/Library/LaunchAgents/ork.watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ork.watch</string>
  <key>ProgramArguments</key>
  <array><string>/path/to/ork</string><string>watch</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/tmp/ork-watch.log</string>
  <key>StandardErrorPath</key><string>/tmp/ork-watch.log</string>
</dict></plist>
```

On Linux, as `~/.config/systemd/user/ork-watch.service`:

```ini
[Unit]
Description=ork watch

[Service]
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/path/to/ork watch
Restart=on-failure

[Install]
WantedBy=default.target
```

We haven't yet run either on a real machine
([L129](../../specs/gaps/limits-watching.md)), so check `ork watch --status`
after you set one up.

A machine that's asleep isn't looking. On waking it looks again, and anything
new still on the list starts then, up to the daily cap. `ork doctor` warns when
a trigger hasn't looked when it should have.

For the details, see the [spec](../../specs/scheduler/watching.md).
