# @krapht/ork

The `ork` command: orchestrate Claude agents on your machine with hierarchical,
serializable workflows.

> **Pre-alpha.** `ork init`, `ork validate`, `ork doctor` and running a single
> node work today; running whole workflows is being built. See the
> [project README](https://github.com/mimshins/ork#readme).

```sh
npm install --global @krapht/ork

ork doctor              # node, git, and your own claude / gh / aws logins
ork init                # scaffold .ork/ with a starter workflow
ork validate            # check .ork/workflows/*.ork.yaml
ork run hello --node lead --input task="add a README" --in-place
                        # run one Claude node; it asks you on the terminal
```

`--driver sdk` (the default) needs `ANTHROPIC_API_KEY` or a cloud provider;
`--driver cli` uses your own logged-in `claude`.

Ork never stores or asks for credentials: it uses the tools you already have,
signed in with your own accounts.

Requires Node.js 24.20 or later. MIT licensed.
