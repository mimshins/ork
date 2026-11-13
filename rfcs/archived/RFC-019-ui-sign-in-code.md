# RFC-019 — `ork ui` signs the browser in with a one-time code

- **Status:** Implemented
- **Date:** 2026-11-13
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-090](../../decisions/ADR-090-ork-ui-signs-in-with-a-code.md)

## Context

`ork ui` starts a loopback server guarded by one random token per start
([ADR-039](../../decisions/ADR-039-local-server.md),
[specs/server/streams-contract-and-security.md](../../specs/server/streams-contract-and-security.md#security)).
That one token does three jobs:

- **The sign-in link.** `signInLink` builds
  `http://127.0.0.1:<port>/?token=<token>`
  (`packages/cli/src/commands/ui.ts:31`) and passes it to the browser opener, so
  the long-lived token is on the opener's argv. Other users' `ps` can read it on
  a shared machine, and a crash report or shell history can keep it. The spec
  says the token is never "put in a process's argv"; the link breaks that.
- **The cookie.** `exchange` in `packages/server/src/guards.ts` swaps `?token=`
  for `ork_ui_<port>=<token>; HttpOnly; SameSite=Strict`, so the browser stores
  the raw API token.
- **The bearer.** `ork mcp` and scripts send the same token as
  `Authorization: Bearer` (`packages/server/src/client.ts:93`); a second
  `ork ui` reads it from `~/.ork/ui.json` (mode 0600) and opens that server
  (`ui.ts:108-113`).

A leak of the link or the cookie is therefore a leak of the credential that also
drives `ork mcp` and the CLI, and it never expires until `ork ui` stops.

Two facts constrain the fix:

- **Restarts keep the cookie working.**
  [ADR-060](../../decisions/ADR-060-ork-ui-supervises-its-server.md) lets the
  page restart the server onto a newly installed `ork`, and reuses the same
  token "so the open tab's cookie still signs it in". A new cookie secret must
  survive a restart too, or every restart signs the browser out.
- **The supervisor and the server are two processes.** `supervise.ts:104` hands
  the child `{ port, token }` over IPC. A second `ork ui` finds the running
  server only through `ui.json`, with no IPC to it.

The audit that raised this (42698ed0) also found that the exchange redirect
builds `location` from `url.pathname` (`guards.ts`, `exchange`). A request path
that begins with `//` gives a protocol-relative `Location`, which is an open
redirect. That is a bug to fix whichever option is chosen.

## Options

### Option A — One-time code and one session secret per `ork ui`

- The server gets `POST /api/sign-in`, which accepts the bearer token only (a
  cookie cannot mint) and returns a random single-use code held in server memory
  with a short expiry.
- `ork ui` calls it, on the first start and when it finds a running server, and
  opens `/?code=<code>`. The exchange redeems the code once and sets the cookie.
- The cookie holds a second random secret, made by the supervisor with
  `newToken()` and passed to the server in the same IPC message as the token, so
  it is kept across restarts like the token. The server accepts the session
  secret only from the cookie and the token only as a bearer, each compared in
  constant time.
- **Pros:**
  - The argv carries a code that is useless once used or expired.
  - The cookie no longer holds the credential `ork mcp` and the CLI use.
  - A restart keeps tabs signed in, as ADR-060 requires.
  - Small: one endpoint, a code map, one more field in the IPC start message,
    and a second comparison in `guard`.
  - The first start and a second `ork ui` share one path.
- **Cons:**
  - All browsers signed in to one `ork ui` share one secret, so a single browser
    cannot be signed out; stopping `ork ui` is the revoke.
  - Until the code is redeemed, a process that reads the argv in that window can
    redeem it first. The user's own browser then gets a 401 and the user sees
    it. It is no worse than today, and the window is short.
  - The session secret does not expire on its own.

### Option B — One-time code and a random session per browser, kept by the server

- Same code flow, but each exchange makes its own session id, which the server
  stores with an expiry.
- **Pros:** one browser can be signed out or expire alone.
- **Cons:**
  - The sessions have to survive a restart, or a page-initiated restart signs
    every tab out. That means a second file in `~/.ork/` at mode 0600, or state
    handed back to the supervisor over IPC. Either is more code and more secrets
    at rest than the threat needs.
  - Ork has no multi-user or multi-browser case today to justify revoking one
    browser.

### Option C — One-time code only; the cookie still holds the token

- **Pros:** fixes the argv exposure with the smallest change, and needs no
  second secret and no restart handling.
- **Cons:** the cookie, and anything that can read the browser's cookie store,
  still holds the credential that `ork mcp` and the CLI accept. The audit's
  second finding stays open.

### Option D — Keep the token link; only collapse leading slashes

- Rests on `ui.json` already holding the token for the same user.
- **Pros:** no change in behavior, nothing to migrate.
- **Cons:** the token stays on the opener's argv (visible to other users' `ps`)
  and in the cookie; the audit finding stays open, and the spec's "never in
  argv" stays untrue.

## Decision

**Option A.** `ork ui` signs the browser in with a single-use, short-lived code
that the server mints for a bearer caller, and the cookie holds a separate
random session secret.

- The code is minted by `POST /api/sign-in`, bearer-only, and kept in memory. A
  restart drops the codes that were not used, which is harmless: `ork ui` mints
  a new one each time it opens the browser.
- The session secret is one per `ork ui` start, made by the supervisor and sent
  to the server over IPC with the token, so a page-initiated restart keeps the
  open tab signed in.
- Bearer auth stays the token, for `ork mcp`, scripts and a second `ork ui`.
- The exchange redirect collapses leading slashes in the path it returns.
- The reasoning: this takes the long-lived credential off argv and out of the
  cookie with the least new state, and keeps ADR-060's restart behavior. Per-
  browser sessions (Option B) buy a revoke nobody needs yet.

## Consequences

- **Code:** `packages/server/src/guards.ts` (code store, a second secret in
  `GuardContext`, cookie check against the session secret, the redirect fix),
  `packages/server/src/dispatch.ts` and `server.ts` (pass the session secret,
  route `/api/sign-in`), `packages/server/src/contract*.ts` (the route and its
  response), `packages/cli/src/browser/supervise.ts` and `serve.ts` (the session
  secret in the IPC start message), and `packages/cli/src/commands/ui.ts`
  (`signInLink` takes a code; both start paths call the endpoint first).
  `ui.json` keeps only the token.
- **Tests:** `packages/server/test/guards.test.ts` and `server.test.ts` use
  `?token=`; they move to the code flow, and gain tests for single use, expiry,
  a cookie that holds the token (now 401), a bearer that holds the session
  secret (now 401), and a `//` path. `packages/cli/test/ui.test.ts:140` changes
  with `signInLink`.
- **Docs and specs to update:** `specs/server/streams-contract-and-security.md`
  (Token), `specs/server/what-it-is-and-ork-ui.md`,
  `specs/cli/running-and-runs.md`,
  [ADR-039](../../decisions/ADR-039-local-server.md) (a new ADR supersedes its
  guards paragraph; the accepted ADR is not rewritten),
  `docs/guides/browser-view/starting-and-commands.md`,
  `docs/getting-started/quickstart.md`, `docs/guides/troubleshooting/setup.md`,
  and the interaction map and roadmap data that mention the link.
- **ADR:** one new ADR when it ships, linked both ways with this RFC; run
  `pnpm rfc:close RFC-019`.
- **Gaps:** add to `specs/gaps.md` that the session secret is shared by every
  browser of one `ork ui` and does not expire.
- **Changeset:** needed (shipped code). Browsers signed in before the upgrade
  hold the old cookie and sign in again with `ork ui`.
- **Out of scope:** the other three follow-ups in the same brief (secret
  masking, agent-facing hardening, task labels) are separate decisions and
  plans.

## Open questions

- How long a code lives. It must cover the time from `ork ui` minting it to the
  browser opening it, including a slow browser start. No value was measured
  here; the plan should set one and test it.
- Whether the code endpoint should also refuse when `mayShowSignIn()` is false
  (`ui.ts`), or whether the check stays only in the CLI. The endpoint cannot
  tell an agent from the user, since both hold the same token in `ui.json`.
- Whether a failed code redemption should say that the code was used or expired,
  or give one generic 401. A specific message helps a user; a generic one gives
  a guesser nothing, though a code is 32 random bytes.
