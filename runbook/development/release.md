# Releasing `@krapht/ork`

## When to use

- A pull request changes shipped code and needs a changeset.
- The "chore: release" pull request is open and ready to merge.
- Setting up publishing for the first time, or a release job failed.

## What is published

Only the CLI, `@krapht/ork` (its `bin` is `ork`), built by tsdown into one
bundle, `packages/cli/dist/bin.mjs`. The private workspace packages
(`@krapht/ork-schema`, `-core`, `-runtime`, and the others) are bundled into it.
Third-party packages in its `dependencies` are installed with it. Versions stay
on `0.x` until the workflow format and the CLI are stable: a breaking change is
a `minor` bump, a fix or addition a `patch`. 1.0.0 comes through the pre-release
channels below.

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
2. [CI](../../.github/workflows/ci.yml) runs its gates (format, lint, typecheck,
   unit, docs, package, map), then its `release` job runs `changesets/action`,
   which opens or updates the **"chore: release"** pull request. The job needs
   every gate, so nothing unchecked is published, and the checks run once per
   push. That pull request runs `pnpm changesets:version`: `changeset version`
   bumps `packages/cli/package.json`, writes `packages/cli/CHANGELOG.md` and
   deletes the consumed changesets, then
   [build-info.ts](../../tools/release/build-info.ts) binds the new version into
   `packages/cli/src/__build_info__.ts`, which `ork --version` and feedback
   read. It also binds it into the Claude Code plugins' `plugin.json` versions.
   `pnpm build` binds them again, and a test fails when one and `package.json`
   disagree. It leaves `ork mcp --expects` in `plugins/ork/.mcp.json` alone:
   that's the oldest Ork the plugin works with
   ([ADR-058](../../decisions/ADR-058-plugin-expects-oldest-ork.md)). A plugin
   or skill change that needs something new in Ork raises it to the first Ork
   that has it, and lands only once that Ork is on npm, as Claude Code reads the
   plugin from `main`.
3. A maintainer reviews and merges the release pull request.
4. The workflow runs again with no changesets left and publishes:
   `pnpm run release` builds the bundle and runs `changeset publish`, which
   publishes to npm with provenance, tags `@krapht/ork@<version>`, and creates
   the GitHub release. Then [latest-tag.ts](../../tools/release/latest-tag.ts)
   moves npm's `latest` to a pre-release
   ([below](#every-pre-release-is-latest-too)); for a plain release it does
   nothing.

Nothing is published from a laptop. The release job runs only in `mimshins/ork`,
never in a fork.

## Channels toward 1.0.0

1.0.0 comes through three pre-release channels, in this order: `alpha`, then
`beta`, then `rc`. Each is Changesets
[pre mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md)
with that channel's name as its tag, and moving on is the maintainer's call:

```sh
pnpm changeset pre enter alpha  # with a major changeset: the next release is 1.0.0-alpha.0
pnpm changeset pre exit         # leave one channel …
pnpm changeset pre enter beta   # … for the next: then 1.0.0-beta.N, and rc the same way
pnpm changeset pre exit         # leaving pre mode: the next release is 1.0.0
```

Commit what each writes in `.changeset/` (`pre.json`). In pre mode every release
pull request bumps the pre-release number (`1.0.0-alpha.1`, `-alpha.2`, …);
switching channels carries the number on (after `1.0.0-alpha.4` comes
`1.0.0-beta.5`). The update check offers the newest version across the `latest`,
`alpha`, `beta` and `rc` tags, so everyone on an older version is offered the
newest pre-release
([updates](../../specs/cli/updates.md#the-new-version-notice)).

### Every pre-release is `latest` too

In pre mode `changeset publish` tags only the channel (`alpha`, …), yet a plain
`npm install --global @krapht/ork` should get the newest pre-release. So after
it, `pnpm run release` runs [latest-tag.ts](../../tools/release/latest-tag.ts):
when `packages/cli/package.json`'s version is an `alpha`, `beta` or `rc`
pre-release that npm has (it asks every 10 seconds for up to about five minutes,
past npm's cache, as a new version can take that long to show), it runs
`npm dist-tag add @krapht/ork@<version> latest`. It never moves `latest` to a
canary or a plain release (Changesets tags that one itself), never to a version
npm doesn't have, and does nothing when `latest` is already there, so a rerun is
safe. When npm still doesn't list the version, it fails the release run: rerun
the job (`changeset publish` skips what's already out), or run
`npm dist-tag add @krapht/ork@<version> latest` yourself. It uses the publish
job's own `NODE_AUTH_TOKEN`; no other secret. To see what it would do:

```sh
node tools/release/latest-tag.ts --dry-run
```

### Canary snapshots

A canary is a snapshot of `main` for people who want experimental work before a
release. A maintainer runs the
[Canary workflow](../../.github/workflows/canary.yml) by hand (Actions → Canary
→ Run workflow, on `main`). It publishes
`@krapht/ork@1.0.0-canary-<datetime>-<sha>` under the `canary` dist-tag: never
`latest`, never a GitHub release or git tag, and nothing is pushed back. Install
one with:

```sh
npm install --global @krapht/ork@canary
```

The update check offers a canary only to someone already running one
([updates](../../specs/cli/updates.md#the-new-version-notice)).

The workflow's steps, in order:

1. Run only for `mimshins/ork` and only from `main`, in the `release`
   concurrency group, so it never races a release.
2. `pnpm run check:all` (`pnpm check` without the cache), the same gates as CI.
3. Delete `.changeset/pre.json` in the throwaway checkout: Changesets refuses a
   snapshot in pre mode. Nothing is committed, so `main` stays in pre mode.
4. `changeset version --snapshot canary`. The `snapshot` block in
   [.changeset/config.json](../../.changeset/config.json) takes the version from
   the pending changesets (`useCalculatedVersion`) and names it
   `{tag}-{datetime}-{commit}`.
5. `node tools/release/build-info.ts` binds the version into `ork --version` and
   the plugins, as a release does.
6. Fail unless `packages/cli/package.json`'s version matches
   `^\d+\.\d+\.\d+-canary-`.
7. Unless **dry-run** is on, `pnpm run build` and
   `changeset publish --tag canary --no-git-tag`, with provenance and the
   `NPM_AUTH_TOKEN` secret. No new secret; the job has only `contents: read` and
   `id-token: write`.

**dry-run** is on by default: the run stops after step 6 and prints the version.
Untick it to publish. After a publish, check that
`npm view @krapht/ork dist-tags` shows `latest` unchanged and that
`ork --version` of the installed canary prints its own version.

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
   `@krapht/ork` with this repository's `ci.yml` (its `release` job), then
   remove the token.

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
- **A pre-release was published but `latest` didn't move:** the job's log has
  `latest unchanged: …` with the reason. Rerunning the job is safe; or, with
  publish rights, run `npm dist-tag add @krapht/ork@<version> latest`.
- **The Canary run fails with "no changesets to snapshot":** `main` has no
  pending changeset, so Changesets versioned nothing. Add a changeset that
  releases `@krapht/ork` on `main` (an empty one does not count) and run again.
- **Changesets says "Snapshot release is not allowed in pre mode":** step 3
  didn't run or `.changeset/pre.json` moved. The workflow removes that file
  before `changeset version --snapshot`; don't commit that removal.
- **A release is queued behind a Canary run:** the workflow shares the `release`
  concurrency group, and GitHub keeps one pending run per group, so a canary
  queued while a release runs can evict a release already pending behind it.
  Don't dispatch a canary while a release is queued; the next push to `main`
  recovers.
- **The first dry run fails at the changelog:** `@changesets/changelog-github`
  uses the job token, and the job has only `contents: read`. Check the first
  dry-run dispatch before any publish.
