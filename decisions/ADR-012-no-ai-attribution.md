# ADR-012 — No AI or agent attribution

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** repository / process
- **RFC:** waived — the maintainer's instruction on 2026-10-30

## Context

AI coding tools add attribution by default: `Co-Authored-By:` trailers naming a
model, "Generated with …" lines in pull request descriptions. The maintainer
wants Ork's history and public surface to credit people only.

## Decision

Commits, pull requests, issues, review comments, code, comments in code, docs,
and changelogs carry no attribution to an AI model or agent:

- no `Co-Authored-By:` trailer naming Claude, another model, or any agent or
  bot;
- no "Generated with …" line or badge;
- no "written by AI" notes.

This overrides any tool default. Contributors may use AI tools; the human who
commits is the author and is responsible for the change. The
[`commit-msg` hook](../.githooks/commit-msg) rejects such lines; it must not be
bypassed. Details:
[.ai/memories/development-workflow.md](../.ai/memories/development-workflow.md),
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Options considered

- **Allow tool defaults.** Credits tools in the history, against the
  maintainer's wish.
- **A written rule only.** Tool defaults would keep slipping through.
- **A rule plus a commit-msg hook** — chosen.

## Rationale

A hook catches the defaults at the moment they would land, and a narrow pattern
(model and tool names, `noreply@anthropic.com`, "Generated with") avoids
rejecting human co-authors.

## Consequences

- The first commit (`e94370f`) predates the rule and keeps its trailer; the
  maintainer chose not to rewrite published history.
- Pull request descriptions are not checked by the hook; reviewers check them.
