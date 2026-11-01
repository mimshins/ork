# @krapht/ork

The `ork` command: orchestrate Claude agents on your machine with hierarchical,
serializable workflows.

> **Pre-alpha.** The workflow format, `ork run` with delegation and worktrees,
> the context compiler, agents, run logs, decisions from any terminal, messages
> between nodes, chat, resume, claims and local feedback work today; a web UI
> comes next. Expect changes between 0.x releases. See the
> [project README](https://github.com/mimshins/ork#readme) and the
> [guides](https://github.com/mimshins/ork/tree/main/docs#readme).

```sh
npm install --global @krapht/ork

ork doctor              # node, git, and your own claude / gh / aws logins
ork init                # scaffold .ork/ with a starter workflow
ork validate            # check .ork/workflows/*.ork.yaml
ork run hello --input task="add a README"
                        # run the workflow; questions come to the terminal
ork worktrees           # the worktrees and branches runs left; `clean` tidies up
ork run hello --node lead --input task="add a README" --in-place
                        # run one Claude node on its own
ork upgrade             # a newer version? upgrade the way you installed Ork
```

`--driver sdk` (the default) needs `ANTHROPIC_API_KEY` or a cloud provider;
`--driver cli` uses your own logged-in `claude`.

Ork never stores or asks for credentials: it uses the tools you already have,
signed in with your own accounts. Once a day it asks the npm registry whether a
newer version is out (`ORK_NO_UPDATE_CHECK=1` turns that off).

Requires Node.js 24.20 or later. MIT licensed.
