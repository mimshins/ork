# ADR-053 — Watching a source, inside a run and to start one

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** workflow format / scheduler / a long-lived process / trust
- **RFC:** [RFC-011](../rfcs/archived/RFC-011-watching-a-source.md)

## Context

A workflow often has to wait on something outside it, and something outside
should sometimes start one. Both could be scripted, but each author would write
their own polling, seen list, backlog guard and spending cap, and a mistake in
any of them spends money with nobody watching. Waiting also counted as work, and
nothing showed what a run was waiting for.

## Decision

**A look is a deterministic program with declared output, and takes no model
turn until something happened.**

**`watch:` on tool and MCP nodes,** rather than a new node type, so every
integration, `allow` rule, secret mask and declared output works unchanged. The
engine owns the timing ([run/watch.ts](../packages/core/src/run/watch.ts)), so
pausing, stopping and showing it are its job. `every`, `until` and `timeout` are
required. A look that failed is tried again up to `misses` in a row; an answer
the node didn't declare fails it at once.

**The time between looks isn't work.** `limits.timeout` stands still while every
running node is between looks, as ADR-043 reasons for a wait on a person. If
anything else is working, the time counts: a stuck session beside a long wait
must still time out. That's narrower than what the RFC's answer said, which
didn't consider a run doing both.

**`ork watch` runs declared triggers,** a long-lived command that's the user's
to keep alive, one per machine. It doesn't live in `ork ui`'s server, as closing
a tab shouldn't stop automation. Webhooks are out: they need an address GitHub
can reach. The guards are Ork's: a first look starts nothing, each key starts
once, a budget is required, with a daily cap and one run at a time by default.

**A person accepts what runs,** in a terminal, on this machine. The hash covers
the trigger and **the text of the workflow it starts**, which the RFC didn't
say: a branch that changes the workflow changes what runs with nobody there as
surely as one that changes the trigger. It re-asks on any workflow edit, and
that's the price. It also covers what the check reads (`.mcp.json`, files its
command names) and the project's folder, so another repository doesn't inherit
it. A hash is only worth what's held to it, so a run starts from the accepted
file by its whole path, and refuses if its text differs from what `ork watch`
read. It can't cover everything a run reads, such as a skill or a script, and
says so ([L119](../specs/gaps/limits-watching.md)). The terminal stops
accidents, not a determined program on the same machine.

**The lock is a row in the store,** rather than the lock file the RFC implied. A
file can't be taken over from a dead holder atomically; a transaction can. A
holder is judged by whether its process started before it took the lock, so a
recycled process id neither blocks `ork watch` nor gets signalled by `--stop`.

**Inputs from a source are marked untrusted,** and `trigger.untrusted` warns of
a prompt that reads one on a node with wide tools. It's a warning, as Ork can't
prove a workflow safe. Values reach a run joined to their flag
(`--input=name=value`), so one can't become another flag.

The floors on `every` are 5 s and 1 min, with nothing measured behind them. They
were left to set on first use, and are one constant each.

## Consequences

- Long waits cost no tokens, and the three examples that prompted this each have
  an answer. "Schedules and webhooks" is answered, with webhooks left out.
- There's a long-lived process, with a lock to keep and a way to die quietly, so
  `ork doctor` reports a trigger that hasn't looked.
- Spending happens with nobody there. The guards limit it, and can't remove it.
- `triggers.yaml` is a second file format, with no JSON Schema or builder yet.
- The store records changes rather than looks, so the Monitor's count and next
  look are estimates, and say "about".
- What's limited for now is in
  [the gaps register](../specs/gaps/limits-watching.md).
