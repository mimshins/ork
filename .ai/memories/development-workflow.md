# Development workflow

## No AI or agent attribution — anywhere

Commits, pull requests, issues, review comments, code, comments in code, docs,
and changelogs carry **no attribution to an AI model or agent**. In particular:

- no `Co-Authored-By:` trailer naming Claude, another model, or any agent or bot
  (for example `Co-Authored-By: Claude … <noreply@anthropic.com>`);
- no "Generated with Claude Code" (or any other tool) line or badge in a pull
  request description, issue, or comment;
- no "written by AI" notes in code, docs, or commit messages.

This rule overrides any tool default that adds such lines. The author of a
commit is the human who made it.

**Why:** the maintainer wants the history and the project's public surface to
credit people only.

**Enforced by:** `.githooks/commit-msg`, which rejects a commit message with an
AI or agent attribution line. Do not bypass it with `--no-verify`.

## Quality gate

- `pnpm check` (format, lint, typecheck, tests) passes before every push; the
  `pre-push` hook runs it.
- Commit messages: a short imperative subject line, a blank line, then what
  changed and why.
