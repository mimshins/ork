# @krapht/ork

The `ork` command: orchestrate coding agents (Claude Code, OpenCode, Command
Code) on your machine with hierarchical, serializable workflows.

> **Alpha.** Workflows of coding agents and tools, run from the terminal or the
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

A workflow that names no agent driver runs on the one that's ready. Today that
is `claude-code`: your own `claude`, logged in or with `ANTHROPIC_API_KEY` or a
cloud provider set. Your own `opencode` (`open-code`) and Command Code's `cmd`
(`command-code`) work too: `--driver <id>`, or a driver per node
([Drivers](https://github.com/mimshins/ork/blob/main/docs/guides/drivers.md)).

Ork is built with Ork: its own workflows plan, build, review and document its
features, and each run is measured against a manual session in
[Benchmarks: Ork building Ork](https://github.com/mimshins/ork/blob/main/benchmarks/README.md).

Ork never stores or asks for credentials: it uses the tools you already have,
signed in with your own accounts. Once a day it asks the npm registry whether a
newer version is out (`ORK_NO_UPDATE_CHECK=1` turns that off).

Requires Node.js 24.20 or later. MIT licensed.
