# The write limit

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built** on `claude-code`, `codex`, `command-code` and `omp`;
`open-code` refuses the run
([write-limit.ts](../../packages/runtime/src/tools/write-limit.ts),
[heavy-hook.ts](../../packages/runtime/src/heavy-hook.ts),
[tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts),
[open-code.ts](../../packages/runtime/src/adapters/open-code.ts); tests:
[write-limit](../../packages/runtime/test/write-limit.test.ts)). Why:
[ADR-110](../../decisions/ADR-110-keep-ork-sessions-apart.md).

`SessionSpec.writeOnly` is a list of folders, relative to the session's `cwd`. A
session that has it may write only under those folders, and never to a file
named CLAUDE.md or AGENTS.md, anywhere, whatever the case of its name. Only
`ork feedback apply` sets it, under
[`knowledge: ork-only`](../project-rules/agents-and-knowledge.md#knowledge),
with `.ork` as the folder
([closing the loop](../feedback/closing-the-loop.md#a-fix-under-knowledge-ork-only)).
Without it, no driver limits where a session writes.

## What is checked

- **The edit tools only.** `Write`, `Edit`, `MultiEdit` and `NotebookEdit` (the
  other drivers' tools by the same names the matcher already maps). A file the
  call names is resolved against `cwd` with its links followed; one that lands
  outside every folder (`../…`, an absolute path elsewhere, a `~` path) is
  refused. A call that names no file Ork can read is refused too.
- **Not the shell.** A `Bash` call that writes (`echo > file`, `sed -i`) is not
  looked at ([L519](../gaps/session-apart-limits.md)). The feedback worker keeps
  its existing fence (no shell, no network), which is what holds it.
- **Yolo or not.** `ork run --yolo` allows what a node's deny list and `only` do
  not refuse, but the write limit refuses still.

## Where it is held

- **`claude-code`.** The session's `PreToolUse` hook
  ([heavy-hook.ts](../../packages/runtime/src/heavy-hook.ts), `writeRefusalOf`),
  which `hookRefusals` arms from the spec. The refusal is a reason the session
  reads, "Ork: &lt;tool&gt; is refused for this file (this session writes only
  under .ork, and never to a file named CLAUDE.md or AGENTS.md). Do not retry
  it.", so it knows where it may write.
- **`codex`, `command-code` and `omp`.** The shared matcher they embed
  (`tool-rules-source.ts`) carries `writeOnlyReason`'s source and refuses in the
  same words ([codex](./codex.md), [omp rules](./omp-rules.md)).
- **`open-code`.** Its permission rules match a path as written, not where its
  links lead, so it cannot hold the limit. A session spec with `writeOnly`
  rejects at start with `OPEN_CODE_NO_WRITE_LIMIT` ("OpenCode can't hold a
  session to its write limit (writeOnly) … run it on claude-code, codex,
  command-code or omp"), so a run never starts unlimited
  ([L518](../gaps/session-apart-limits.md)).

## What carries it

`ork feedback apply` passes it as a run option; the run puts it on every node's
context and the plan puts it on each session's spec. The run records it in
`run.started`'s `settings` (`writeOnly`), so `ork resume` holds the resumed run
to it with no option. A project file that can't be read refuses the apply, so a
broken file can't drop the limit. It is not carried to a nested `workflow.call`
run, or to the session an owner asks a question through
([L520](../gaps/session-apart-limits.md)).
