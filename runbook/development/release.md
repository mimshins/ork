# Releasing `@krapht/ork`

## When to use

- A pull request changes shipped code and needs a changeset.
- The "chore: release" pull request is open and ready to merge.
- Setting up publishing for the first time, or a release job failed.

## What is published

Only the CLI, `@krapht/ork` (its `bin` is `ork`), built by tsdown into one
bundle, `packages/cli/dist/bin.mjs`. The private workspace packages
(`@krapht/ork-schema`, `-core`, `-runtime-claude`, and the others) are bundled
into it. Third-party packages in its `dependencies` are installed with it.
Versions stay on `0.x` until the workflow format and the CLI are stable: a
breaking change is a `minor` bump, a fix or addition a `patch`.

## Add a changeset (every pull request that ships code)

```sh
pnpm changesets:create   # pick @krapht/ork, patch or minor, one changelog line
pnpm changesets:empty    # docs, tests, tooling: nothing to release
```

Commit the file it writes in `.changeset/`. CI's `changeset` job fails when a
pull request changes `packages/*/src/`, a `package.json`, or a tsdown config
without one
([tools/release/check-changeset.ts](../../tools/release/check-changeset.ts)).

## The release flow

1. A pull request with a changeset is merged into `main`.
2. The [Release workflow](../../.github/workflows/release.yml) runs
   `pnpm check`, then `changesets/action`, which opens or updates the **"chore:
   release"** pull request. That pull request runs `pnpm changesets:version`:
   `changeset version` bumps `packages/cli/package.json`, writes
   `packages/cli/CHANGELOG.md` and deletes the consumed changesets, then
   [build-info.ts](../../tools/release/build-info.ts) binds the new version into
   `packages/cli/src/__build_info__.ts`, which `ork --version` and feedback
   read. `pnpm build` binds it again, and a test fails when the file and
   `package.json` disagree.
3. A maintainer reviews and merges the release pull request.
4. The workflow runs again with no changesets left and publishes:
   `pnpm run release` builds the bundle and runs `changeset publish`, which
   publishes to npm with provenance, tags `@krapht/ork@<version>`, and creates
   the GitHub release.

Nothing is published from a laptop. The release job runs only in `mimshins/ork`,
never in a fork.

## One-time setup

1. **npm:** an npm user or organization that owns the `@krapht` scope creates an
   automation (or granular, publish-only) access token for `@krapht/ork`.
2. **GitHub:** add it as the repository secret `NPM_AUTH_TOKEN` (Settings →
   Secrets and variables → Actions).
3. **GitHub:** in Settings → Actions → General, enable **Allow GitHub Actions to
   create and approve pull requests**, so the workflow can open the release pull
   request.
4. After the first publish, consider npm
   [trusted publishing](https://docs.npmjs.com/trusted-publishers) for
   `@krapht/ork` with this repository's Release workflow, then remove the token.

## Check a build locally

```sh
pnpm run build                          # packages/cli/dist/bin.mjs
node packages/cli/dist/bin.mjs --help
(cd packages/cli && npm pack --dry-run) # the files that would be published
```

## Troubleshooting

- **The release pull request is not opened:** check step 3 of the setup, and
  that `main` has a changeset that is not empty.
- **Publish fails with 401 or 403:** the `NPM_AUTH_TOKEN` secret is missing,
  expired, or lacks publish rights on the `@krapht` scope.
- **Publish fails on provenance:** provenance needs the job's `id-token: write`
  permission and a public repository.
