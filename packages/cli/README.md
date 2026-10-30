# @krapht/ork

The `ork` command: orchestrate Claude agents on your machine with hierarchical,
serializable workflows.

> **Pre-alpha.** `ork init`, `ork validate` and `ork doctor` work today; running
> workflows is being built. See the
> [project README](https://github.com/mimshins/ork#readme).

```sh
npm install --global @krapht/ork

ork doctor              # node, git, and your own claude / gh / aws logins
ork init                # scaffold .ork/ with a starter workflow
ork validate            # check .ork/workflows/*.ork.yaml
```

Ork never stores or asks for credentials: it uses the tools you already have,
signed in with your own accounts.

Requires Node.js 24.20 or later. MIT licensed.
