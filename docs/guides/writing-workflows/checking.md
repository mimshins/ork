# Checking a workflow

_Part of [Writing workflows](../writing-workflows.md)._

```sh
ork validate                    # every workflow in .ork/workflows/
ork validate path/to/file.ork.yaml
```

It reports schema errors, an unknown `parent`, cycles without `maxRounds`,
references to nodes that do not exist or do not run first, and skill or context
paths that resolve to nothing, each with its line
([all the checks](../../../specs/graph-compiler.md)).

Then it tries every way through the workflow, without running a session, a tool
or a script, and ends with a line such as
`Walked 14 ways through: 2 succeed, 12 fail.` It warns about a node no way
reaches, and a loop only its rounds can end. `ork run` prints the same warnings
before it starts, and they don't stop it. To see how a run can end, and the
choices that lead there:

```sh
ork validate path/to/file.ork.yaml --paths
```

This tries the shape of the workflow, not your work: it can't tell whether an
outcome will happen, or see a mistyped field a tool never said it reports.
