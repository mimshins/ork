# The `extract` tool

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built**: the tool, its steps and programs, containment and refusals,
the refusal of shell reads, and the withheld tools (RFC-025), served on
`claude-code`, `open-code`, `command-code`, `codex` and `omp`
([extract.ts](../../packages/runtime/src/tools/extract.ts), `extract-schema.ts`
(the arguments' schema),
[extract-steps.ts](../../packages/runtime/src/tools/extract-steps.ts),
[extract-error.ts](../../packages/runtime/src/tools/extract-error.ts),
[extract-git.ts](../../packages/runtime/src/tools/extract-git.ts),
[extract-search.ts](../../packages/runtime/src/tools/extract-search.ts),
[extract-glob.ts](../../packages/runtime/src/tools/extract-glob.ts),
[contain.ts](../../packages/runtime/src/tools/contain.ts); tests:
[extract](../../packages/runtime/test/extract.test.ts),
[steps](../../packages/runtime/test/extract-steps.test.ts),
[containment](../../packages/runtime/test/contain.test.ts),
[contract](../../packages/runtime/test/contract/contract.test.ts)). Why:
[RFC-023](../../rfcs/archived/RFC-023-extract-tool-for-session-reads.md), option
2a, and [ADR-098](../../decisions/ADR-098-extract-tool.md). An A/B benchmark of
`reading: open` against `reading: extract` was inconclusive: sessions read
82–100% of their reading weight through `extract` in both arms, and neither cost
more ([rfc-025-reading](../../benchmarks/rfc-025-reading/README.md),
[carried weight](../../benchmarks/method.md#carried-weight)).

A tool result stays in the conversation, and every later turn reads it again
from the cache. `extract` reads part of a file, searches, or shows a diff, and
returns only the extract, so a whole file or a long diff never enters the
conversation. It runs a short list of read-only steps in Ork's process: no
model-written code, no shell, no sandbox.

## Contents

- [Who gets `extract`, and what it takes](./extract-arguments.md)
  - [Who gets it](./extract-arguments.md#who-gets-it)
  - [Steps](./extract-arguments.md#steps)
    - [Search](./extract-arguments.md#search)
- [What `extract` keeps a session to](./extract-reading-rules.md)
  - [Shell reads](./extract-reading-rules.md#shell-reads)
  - [Withheld tools](./extract-reading-rules.md#withheld-tools)
  - [Where it may read](./extract-reading-rules.md#where-it-may-read)
- [How `extract` runs git, and what it returns](./extract-results.md)
  - [No shell](./extract-results.md#no-shell)
  - [The result](./extract-results.md#the-result)
  - [Limits](./extract-results.md#limits)
