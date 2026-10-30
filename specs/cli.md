# The ork CLI

Status: **Partial**: `ork init`, `ork validate` and `ork doctor` are built
([code](../packages/cli/src/main.ts),
[tests](../packages/cli/test/cli.test.ts)); the other commands are specified.
Published as `@krapht/ork` ([release](../runbook/development/release.md),
[ADR-015](../decisions/ADR-015-changesets-and-one-bundled-cli.md)).

```
ork init                         # scaffold .ork/, .gitignore entries, example workflow
ork doctor                       # check node, git, claude (login or API key), gh auth, aws identity
ork validate <wf>                # schema + graph compile; prints errors with yaml line numbers
ork run <wf> [--input k=v] [--detach] [--driver sdk|cli]
ork ps / ork logs <run> [--node n] [--follow]
ork tree <run>                   # live ownership tree with status, tokens, $ per node
ork decide [<run>]               # answer pending decisions
ork chat <run> <node>
ork stop|resume <run>
ork context explain <wf> <node>
ork feedback [list|show|dismiss] # local feedback items (triage, apply, lesson, publish: M2)
ork ui [--port 4417]             # milestone 2
```
