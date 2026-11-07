# ADR-061 — Release channels toward 1.0.0

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** distribution / release
- **RFC:** waived — the maintainer chose among the options below directly, after
  0.4.0 shipped
- **Amends:** [ADR-038](./ADR-038-update-notice-and-upgrade.md) (which version
  the update check offers)

## Context

Ork 0.4.0 shipped on npm under the single `latest` tag, and the update check
([ADR-038](./ADR-038-update-notice-and-upgrade.md)) read only that tag. The next
step is 1.0.0, reached through pre-releases, and some experimental work needs a
way out to the people who want it without reaching everyone else.

## Decision

1. **Channels.** The pre-release channels are `alpha`, `beta` and `rc`, in that
   order toward 1.0.0. Each is Changesets' pre mode with that tag
   (`changeset pre enter alpha`, then `beta`, then `rc`, each when the
   maintainer says); `changeset pre exit` gives 1.0.0. The first release after
   0.4.x is `1.0.0-alpha.0`.
2. **Every pre-release is also `latest`.** Ork is pre-1.0 and has one line of
   development: a plain `npm install -g @krapht/ork` gets the newest alpha, beta
   or rc. Changesets tags a pre-release only with its channel, so the release
   script then moves `latest` to it
   ([latest-tag.ts](../tools/release/latest-tag.ts)), never to a canary, never
   to a version npm doesn't have, and only when `latest` isn't already there.
3. **The update check takes the newest across the channels.** The check,
   `ork upgrade`, `ork doctor` and `ork ui`'s banner offer the highest version,
   by semver precedence, across `latest`, `alpha`, `beta` and `rc`. Other tags
   are ignored.
4. **Canary.** Experimental features live on `main` behind an explicit opt-in,
   off by default; a canary is a snapshot published from `main` by hand under
   the `canary` tag, never `latest`. The `canary` tag is considered only by a
   running canary, which is offered whichever version is newest. Everyone else
   never sees it: `canary` sorts above `alpha` and `beta` by semver, so taking
   the newest of every tag would push canaries on everyone. (The opt-in and the
   canary workflow are built later; the check's rule is in place now.)

The detail is in [updates](../specs/cli/updates.md) and the
[release runbook](../runbook/development/release.md).

## Options considered

- **Pre-releases only on their channel tag, `latest` staying on 0.4.x:** the
  usual npm practice, safe for anyone not opting in. Rejected: there is no 0.x
  line worth keeping, and everyone should be on the way to 1.0.
- **The update check following only your own channel:** an alpha user is offered
  alphas, a stable user stable ones. Rejected in favour of the newest across the
  channels, so nobody is left behind on an older line; canaries are the
  exception, by rule 4.
- **A long-lived `canary` branch, published on every push:** real isolation for
  experiments, at the cost of drift from `main`, fixes landing twice, and a
  second line beside pushing straight to `main`. Rejected for flags on `main`
  and snapshots on demand.
- **Short-lived experiment branches with canaries from any branch:** no flags in
  `main`'s code, but every experiment its own merge later. Not chosen.

## Rationale

One line of development is what a single maintainer pushing straight to `main`
can keep honest. Making every pre-release `latest`, and offering the newest
across the channels, keeps every user on it, while canaries, the only builds
that may be broken on purpose, reach only the people who installed one.

## Consequences

- From `1.0.0-alpha.0`, a plain install gets a pre-release; the installation
  guide says how to pin 0.4.x (`npm install -g @krapht/ork@0.4`).
- The update record keeps its single `latest` field, now meaning "the newest
  this machine may be offered", so older Orks still read it.
- Changesets numbers pre-releases across a switch of channel (after
  `1.0.0-alpha.4` comes `1.0.0-beta.5`), as the runbook notes.
- Still to build, before the first canary: the experiments registry and opt-in
  (listed by `ork doctor`), and the manual canary workflow, with Changesets'
  snapshot settings so a canary is `1.0.0-canary-<datetime>-<sha>`.
