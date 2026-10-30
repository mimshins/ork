# Changesets

Each pull request that changes what users get adds a changeset: a Markdown file
here naming the bump for `@krapht/ork` and a line for the changelog.

```sh
pnpm changesets:create   # describe a change to the CLI (patch or minor on 0.x)
pnpm changesets:empty    # internal-only change: docs, tests, tooling
```

The private workspace packages (`@krapht/ork-*`) are bundled into the CLI, so a
change to any of them is a change to `@krapht/ork`. The release procedure is in
[runbook/development/release.md](../runbook/development/release.md).
