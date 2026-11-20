# ADR-109 — Permissions without asking: a shell reader in core, and `unlisted`

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** runtime port, workflow format, project rules
- **RFC:** [RFC-028](../rfcs/archived/RFC-028-permissions-without-asking.md)

## Context

Claude Code asks Ork's `permission` tool about every call its own rules neither
allow nor deny, and each such call reached a person: one read-only node asked
seven times, all for reads, and another waited 58 minutes on a command its
prompt had ruled out. A node could not refuse what its rules did not allow, and
an allow was given one call at a time. RFC-028 chose to read the shell line with
one shared reader and a shipped set of reads (1A), refuse in the `permission`
tool with an opt-out (3A), offer scopes whose "always" writes the project's
`permissions.allow` (2A), and propose rules people keep allowing as feedback
(4A). This record keeps the parts that are hard to reverse.

## Decision

- **The shell reader, the shipped reads and the rule a prompt offers live in
  `@krapht/ork-core`** (`readShellLine`, `isShippedRead` and `SHIPPED_READS`,
  `ruleFor`, and the verdict `permissionVerdict`), exported from its entry
  point. Core's decision queue and feedback signals need them, and the runtime
  imports core. The reader is one self-contained function, so the other drivers'
  guards embed its source and read a line the same way.
- **`unlisted: refuse | ask` is part of `ToolRulesSchema`**, so it is valid as a
  node's `tools.unlisted`, a workflow's `rules.permissions.unlisted` and a
  project's `permissions.unlisted`. It is one value, not a list: the node's wins
  over the workflow's, which wins over the project's; unset, a `readonly` node
  refuses and any other asks. It is optional, with no `schemaVersion` bump.
- **The comment-keeping edit of a project file lives in `@krapht/ork-schema`**
  (`withAllowRules`, built on its line-keeping merge, `keepingUntouchedLines`),
  and core does the file I/O (`addAllowRules`): schema owns the project file's
  format, core owns where it is and when it is written.

The behavior is specified in
[permissions without asking](../specs/project-rules/permissions.md).

## Options considered

- **Project rules only (1B):** add the reads to this repository's rules. Every
  other project would meet the same prompts, and `ork logs` is Ork's own
  command, not a project's. Rejected.
- **The shipped set for read-only nodes only (1C):** a writing node asks about
  the same reads just as often, and it would be a second list to explain.
  Rejected.
- **Refuse in the `PreToolUse` hook (3B):** the hook runs before Claude Code's
  own rule check, so it could refuse a call Claude Code would have allowed.
  Rejected.
- **Refusal opt-in only (3C):** the evidence's node would still wait unless its
  author found the key. Rejected.
- **"Always" in a per-user file (2B), or asking which file (2C):** a new file,
  schema and precedence rule, or two write paths and one more question on a
  prompt meant to shorten. Rejected.
- **The reader in the runtime package:** the queue and the signals in core could
  not use it. Rejected.

## Rationale

One reader, read the same way by the verdict, the prompt's rules, the remembered
scopes, the suggestions and the guards, means a line is never allowed by one
part and read differently by another. A scalar `unlisted` in the existing rules
schema reaches all three levels with one change and merges like the other scalar
rules. Keeping the YAML edit with the rest of the file format keeps one package
responsible for what a valid project file is.

## Consequences

- Hard to reverse: core's public API gains the reader, the shipped set, the rule
  generalisation and the verdict, and the workflow and project file formats gain
  `unlisted`. Removing the key later would need a migration for files that use
  it.
- A read-only node that relied on asking for a command outside its rules (such
  as the tests) is now refused until it has a rule or `unlisted: ask`.
- The shipped reads are a list Ork keeps true as the tools change, and only
  `claude-code` refuses, remembers and suggests; both are recorded in
  [gaps](../specs/gaps/permissions-limits.md).
- No new runtime dependency.
