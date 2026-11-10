# @krapht/ork

The `ork` command: orchestrate Claude agents on your machine with hierarchical,
serializable workflows.

> **Alpha.** Workflows of Claude agents and tools, run from the terminal or the
> browser (`ork ui`). Expect changes until 1.0.0. See the
> [project README](https://github.com/mimshins/ork#readme), the
> [guides](https://github.com/mimshins/ork/tree/main/docs#readme) and
> [what's new](https://github.com/mimshins/ork/blob/main/docs/whats-new.md).

Rather have your coding agent set it up? See
[With your agent](https://github.com/mimshins/ork/blob/main/docs/getting-started/with-your-agent.md).

```sh
npm install --global @krapht/ork

ork doctor              # node, git, and your own claude / gh / aws logins
ork init                # .ork/ with a starter workflow
ork validate            # check .ork/workflows/*.ork.yaml
ork run hello --input task="add a README"
                        # run the workflow; questions come to the terminal
ork ui                  # your runs in the browser
ork worktrees           # the worktrees and branches runs left
ork worktrees clean     # removes the merged ones; asks first
ork upgrade             # a newer version? upgrade the way you installed Ork
```

A workflow that names no Claude driver runs on the one that's ready. Today that
is `claude-code`: your own `claude`, logged in or with `ANTHROPIC_API_KEY` or a
cloud provider set. `--driver claude-code` names it.

Ork never stores or asks for credentials: it uses the tools you already have,
signed in with your own accounts. Once a day it asks the npm registry whether a
newer version is out (`ORK_NO_UPDATE_CHECK=1` turns that off).

Requires Node.js 24.20 or later. MIT licensed.
