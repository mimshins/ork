# RFC-002 — Standalone binaries and a one-line installer

- **Status:** Proposed
- **Date:** 2026-10-30
- **Supersedes:** —
- **Superseded by:** —

## Context

Ork ships as one npm package, `@krapht/ork`, bundled by tsdown
([ADR-015](../../decisions/ADR-015-changesets-and-one-bundled-cli.md)).
Installing it needs Node 24 and npm. The author wants a one-line install like
Kiro's CLI (`curl -fsSL https://cli.kiro.dev/install | bash`), which downloads a
native binary for the machine, checks its SHA-256 against a manifest, installs
it in `~/.local/bin`, and prints how to put that on the `PATH`. It needs no
Node.

What a binary has to carry:

- **Ork's own code and its JavaScript dependencies** (`citty`, `yaml`, `zod`,
  the Agent SDK's JavaScript). The npm bundle keeps them external today.
- **Not the Claude Code binary.** The Agent SDK runs a native Claude Code
  executable from a per-platform optional dependency
  (`@anthropic-ai/claude-agent-sdk-darwin-arm64` and so on). It is 276 MB on
  macOS arm64 and its licence reads "© Anthropic PBC. All rights reserved. Use
  is subject to the Legal Agreements". Ork must not redistribute it. The SDK
  takes `pathToClaudeCodeExecutable` to run another one.

The author has decided (2026-10-30): binaries rather than an npm-backed script;
the script served from raw GitHub; the SDK driver uses the user's own `claude`;
macOS arm64 and x64 first; updates through `ork upgrade`.

## Options

### Option A — Node single executable applications (SEA)

Bundle the CLI and its dependencies into one file, build a SEA blob, inject it
into the official Node 24 binary for each target with `postject`, and ad-hoc
sign it on a macOS runner (`codesign --sign -`), which arm64 macOS requires.

- **Pros:** the same runtime the tests and the npm package use; Node's own,
  supported mechanism; no new runtime dependency.
- **Cons:** a binary of roughly Node's size; one build per target; SEA has rules
  about the entry script (to verify for Node 24: see open questions).

### Option B — `bun build --compile`

- **Pros:** cross-compiles every target from one runner; one command.
- **Cons:** a different runtime from the one Ork is tested on (Node 24's
  `node:http`, child processes and the Agent SDK would run on Bun); a new
  toolchain in the release.

### Option C — An npm-backed script

`install.sh` checks for Node 24 and runs `npm install -g @krapht/ork`.

- **Pros:** tiny; reuses npm provenance; the SDK's platform package comes as an
  optional dependency.
- **Cons:** still needs Node; not what the author asked for.

## Decision

**Option A**, with the author's choices:

- **Targets:** `darwin-arm64` and `darwin-x64`, built on macOS runners when a
  release is published. Linux and Windows can follow as targets in the same
  workflow.
- **Artifacts:** `ork-<version>-darwin-<arch>.tar.gz` and `SHA256SUMS` on the
  GitHub release, with GitHub artifact attestations
  (`actions/attest-build-provenance`).
- **`install.sh`** in the repository, run as
  `curl -fsSL https://raw.githubusercontent.com/mimshins/ork/main/install.sh | sh`:
  detects the platform, downloads the latest release (or `ORK_VERSION`),
  verifies the SHA-256 (and the attestation when `gh` is available), installs
  `~/.local/bin/ork`, never uses `sudo`, and prints the `PATH` line when needed.
  It reads no credentials and sends nothing but the downloads.
- **The SDK driver** in a standalone binary runs the user's own `claude` through
  `pathToClaudeCodeExecutable`, as the CLI driver already does; `ork doctor`
  warns when that `claude` is older than the SDK expects. The npm package keeps
  using the SDK's own platform binary.
- **`ork upgrade`** checks the latest GitHub release, downloads the binary for
  the machine, verifies its checksum, and replaces itself; `ork doctor` says
  when a newer version exists. In an npm install it says to use npm instead.
- **npm stays** the other way to install, and the release of both stays one
  changesets flow.

## Consequences

- The release workflow gains a job that builds, signs, checksums and attests the
  binaries after changesets publishes, and uploads them to the release.
- A self-contained bundle (dependencies inlined) is built beside the npm one.
- New code: the runtime's SDK driver option for an external `claude`, a `doctor`
  check for its version, and `ork upgrade`. Specs to update: `specs/cli.md`,
  `specs/runtime.md`, `runbook/development/release.md`; an ADR on ship; the
  README's install section; the roadmap's installer item.
- `THIRD_PARTY_NOTICES.md` ships inside the archive with the binary, since the
  bundled dependencies are redistributed.

## Open questions

- Node 24's SEA entry-script rules (CommonJS only, or ESM too) and whether
  `useCodeCache` helps start-up; to settle in a spike before building it.
- The minimum `claude` version the SDK needs, and how `doctor` reads it.
- macOS: ad-hoc signing is enough for a `curl` download (no quarantine flag);
  notarization would need an Apple Developer account. Is ad-hoc enough for now?
