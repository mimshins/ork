# Limits found saying why an Ork tool call failed

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the message an Ork tool's refusal or failure carries to the
feedback loop
([ADR-106](../../decisions/ADR-106-tool-result-carries-the-ork-message.md),
[capture](../feedback/capture.md),
[the `extract` tool](../runtime/extract-tool.md)). What was left simpler, or
could not be checked:

- **L484 · A run keeps only the first message per tool.** A `tool.arguments` or
  `tool.error` record is one per tool per run (the observer's duplicate rule),
  so a second refusal of `extract` with a different message, in the same run, is
  dropped, and the record shows only the first. The item's other runs add their
  own. Keeping the distinct messages of a run, as evidence on the same record,
  would close this.
- **L485 · Claude Code's own validation text has no message.** When the
  arguments are not even valid JSON (Claude Code's `__unparsedToolInput`, a call
  like `from: 1290"`) or fail the schema Claude Code checks first, the text is
  Claude Code's, with no Ork marker. Ork copies nothing from an unmarked result,
  so it files as `tool.error` (an Ork bug) without a message, though Ork cannot
  fix it. Only a text that carries a marker is Ork's to keep.
- **L486 · A pattern git rejects is told by git's wording.** `extract` files an
  invalid regular expression in `search` or `match` as the agent's mistake when
  `git grep` exits 128 and stderr reads `fatal: -e option, '<pattern>': …` or
  `fatal: command line, '<pattern>': …`. A git version that words it otherwise
  falls back to `git failed: …`, filed as an Ork bug. The test runs real git and
  checks the class, not the line.
- **L487 · `null` and a JSON string for `steps` or `programs` are taken
  silently.** The tool accepts them as some clients send them, so a client that
  sends them stays unnoticed. A string that does not parse is refused with what
  to send instead.
- **L488 · The marker is matched as a substring, and the tool name is the
  guard.** `orkMessage` and the fault detection find the marker anywhere in a
  result, so any tool's error text that holds it would match. Only the
  `mcp__ork__` name filter in `signals.ts` keeps non-Ork text out of feedback;
  the Claude Code decoder sees only `tool_use_id`, so it cannot check the name
  itself.
- **L489 · An error thrown inside an Ork tool has no message.** It reaches the
  catch in `mcp-http.ts` without the marker, so its `tool.error` carries none.
  Wrapping that catch with the failure marker would cover every Ork tool; it was
  left out of this change.
