# Experiments

_Part of [Project rules](../project-rules.md)._

Status: **Built** ([experiments.ts](../../packages/core/src/experiments.ts),
[tests](../../packages/core/test/experiments.test.ts)). No experiment ships yet.
Why: [ADR-066](../../decisions/ADR-066-experiments-registry.md).

Work not ready for everyone sits on `main`, off until asked for:

```yaml
experimental: [some-feature]
```

or `ORK_EXPERIMENTAL=some-feature,other-feature` (spaces around names and empty
items are ignored). Both at once give the union. Outside a project only the
environment counts; the project file is `.ork/project.yaml` or an attached
project's own ([projects](../projects.md)).

- **One registry.** A name works only if `EXPERIMENTS` has it. An entry (name,
  summary, spec) comes with the change that adds its experiment.
- **One question.** A consumer calls `experimentOn(name, …)`, which reads the
  environment and takes the project's rules; nothing else reads
  `ORK_EXPERIMENTAL`. With any unknown name, every gate is off.
- **A gate that refuses** says so with `experimentOffMessage(name)`:
  `some-feature is experimental; turn it on with "experimental: [some-feature]" in .ork/project.yaml or ORK_EXPERIMENTAL=some-feature`.
- **An unknown name is an error** (`experiment.unknown`) on every workflow:
  `ork validate`, `ork run`, the builder, the MCP tools and triggers refuse it,
  with its source and the known names:
  ``.ork/project.yaml:3:5: names an unknown experiment `x`; known: …``, or
  ``ORK_EXPERIMENTAL names an unknown experiment `x`; known: …``.
  [`ork doctor`](../cli/worktrees-agents-context-and-doctor.md#doctor) reports
  it as a failed check.

The opt-in adds no event and isn't stored with a run: it is read each time a
workflow is checked, a resume included, on either driver alike. Nothing promotes
or removes an experiment yet ([G28](../gaps.md#gaps)).
