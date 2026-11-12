# Limits: follow-ups

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building follow-ups ([follow-ups](../follow-ups.md),
[ADR-086](../../decisions/ADR-086-follow-ups.md)). What was left simpler:

- **L300 · Closing a follow-up changes only Ork's store.** A `file` store's
  entry is appended once and never rewritten when the follow-up is done, dropped
  or reopened, and a `github` issue is not closed. The file and the issue say
  what the follow-up was when it was added; `ork follow-ups list` and the panel
  say what it is now.
- **L301 · GitHub closures are not synced back.** An issue closed on GitHub by
  hand leaves its follow-up `waiting` or `due` in Ork until someone marks it.
- **L302 · A merged duplicate is not written out again.** A follow-up that
  merges into an open one adds its text to Ork's store only: the `file` entry
  and the `github` issue keep the first text.
- **L303 · The redactor rewrites emails and hosts in drafts and steps.** Text is
  scrubbed with the feedback redactor, which is made for what leaves the
  machine, so a message's draft that names an address or a host, or a step's
  command that uses a URL, is stored with `<host>` or an address removed.
  Nothing marks a draft or a command as the person's own to keep.
- **L304 · A follow-up coming due raises no desktop notification.** `ork watch`
  prints a line and `ork ui` sends its due count on the overview stream, which
  the page shows on the tab and in the live region; no notice reaches the
  desktop when neither is in front of the person.
- **L305 · `--follow-ups` fills the workflow's `brief` input only.** A workflow
  with no `brief` input, or that wants the follow-ups as something else, is
  refused, and the brief is made of each follow-up's title, id, body and files.
- **L306 · `keptIn.fallback` is derived, not recorded.** The server says a
  follow-up fell back to Ork's store when its place differs from the project's
  rule now; it does not keep the reason it fell back, so a follow-up added
  before the rule changed can read as a fallback.
- **L307 · The panel is a reader and a closer.** It has no form to add a
  follow-up, no "Run it…" button that starts `ork run --follow-ups`, no tick per
  step and no bulk selection or action; each is `ork follow-ups` in a terminal.
- **L308 · Recording a publish relies on `build`'s `published` step.** Ork
  learns a run published `<ref>` only from `ork follow-ups published <ref>`,
  which `build`'s `published` node calls. A workflow that publishes another way,
  or a run that stops before that node, leaves its follow-ups without a `ref`
  and its taken ones open.
- **L309 · A ref whose branch was deleted never comes due.** An `after-merge`
  follow-up that waits on a branch name reads it with `gh api …/compare`, which
  answers 404 once the branch is deleted (as a merged pull request's usually
  is), so each check reports an error and the follow-up waits. Recording the
  pull request's URL instead of the branch would be sturdier: `gh pr view` still
  reads a merged one.
- **L310 · A read of the list runs the due check.**
  `GET /api/projects/:id/follow-ups`, and so the panel's 30-second read, runs
  the `gh` check each time, up to three `gh` calls for each open ref, though the
  schedule is every 10 minutes. Reading the store alone, and checking on an
  explicit reload, would spare the calls.
- **L311 · A `file` store's entries from `declare` come after the commit.**
  Through `build`, the entries a session adds before the change is published are
  committed with it, but `declare` records the plan's and the deferred
  follow-ups after the publish, so those entries land in the worktree outside
  the published commit, for the maintainer to commit.
- **L312 · A follow-up for another project gets no `ref`.** `recordPublished`
  looks at this project's follow-ups only, so a `project:<name>` one with
  `due: after-merge` stays without a `ref` in that project's list, and waits
  until someone runs `ork follow-ups due`.
