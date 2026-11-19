# Sessions rule

_Part of [Project rules](../project-rules.md)._

Status: **Built**: the key, its check and its merge
([project.ts](../../packages/schema/src/project.ts),
[rules.ts](../../packages/core/src/project/rules.ts),
[tests](../../packages/schema/test/sessions-rule.test.ts)), and the scheduler's
decision and handover note ([fresh sessions](../scheduler/fresh-sessions.md)).
Off by default. Why:
[ADR-103](../../decisions/ADR-103-fresh-session-for-the-next-task.md).

```yaml
sessions:
  freshOver: never # never | a number of tokens, 1 or more
```

`freshOver` is the context size over which an owner's next delegated task to a
`session: resume` worker starts a fresh session, not a resumed one. Default
`never`: the rule is off and every such worker resumes. It takes an integer of 1
or more, with no upper bound; `0`, a negative number, a fraction and any other
word are refused by `ork validate`, in the file and in a workflow's `rules:`. A
workflow's value wins over the project's. The `sessions` object merges as a
whole, not key by key as `git` does: a workflow that sets `sessions` replaces
the project's. It is a rule, not a node field, so one role cannot differ from
another inside a workflow.
