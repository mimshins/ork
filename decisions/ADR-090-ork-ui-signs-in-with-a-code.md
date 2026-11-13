# ADR-090 — `ork ui` signs the browser in with a one-time code

- **Status:** Accepted
- **Date:** 2026-11-13
- **Topic:** server / CLI / security
- **RFC:** [RFC-019](../rfcs/archived/RFC-019-ui-sign-in-code.md) (option A,
  accepted 2026-11-13); audit 42698ed0
- **Supersedes in part:** [ADR-039](./ADR-039-local-server.md), its "Guards"
  paragraph (5): the token no longer goes in the link or the cookie. The rest of
  ADR-039 stands.
- **Builds on:** [ADR-060](./ADR-060-ork-ui-supervises-its-server.md) (the
  supervisor hands the server its secrets over IPC and keeps them across a
  restart)

## Context

One random token per `ork ui` did three jobs: the sign-in link's `?token=` (on
the browser opener's argv), the browser's cookie, and the bearer for `ork mcp`,
scripts and a second `ork ui`. A leaked link or cookie was a leaked credential
that never expired, and the spec's "never in a process's argv" was untrue. The
exchange redirect also built `location` from the request path, so a path that
began with `//` gave a protocol-relative redirect.

## Decision

1. **A code, minted for a bearer.** `POST /api/sign-in` takes the token as a
   bearer only (a cookie, or the session secret as a bearer, is refused) and
   answers `{ code, expiresIn: 60 }`. A code is 32 random bytes, single use,
   valid 60 s, in server memory (a restart drops the unused ones).
2. **`ork ui` mints it, then opens `/?code=…`.** Both start paths (first start
   and "already running") go through one helper; the token is only a request
   header. The check that refuses an agent in a run stays in the CLI
   ([L80](../specs/messaging/scripts-limits.md)): the server cannot tell an
   agent from the user, as both hold the token. If the server gives no code (an
   older Ork), `ork ui` says so and prints no link.
3. **The cookie holds a session secret, not the token.** The supervisor makes it
   with `newToken()` once and sends it to the server in the start message (an
   optional `session` field), so a restart keeps the tab signed in; a server
   that gets none makes its own. The token is only a bearer and the session
   secret only a cookie; each is compared in constant time against its own
   secret, and the other is 401.
4. **One generic 401** for a used, expired or wrong code.
5. **The redirect collapses leading slashes** in the path it returns.

## Options considered

- **B. A session per browser, kept by the server:** one browser could be signed
  out alone, but the sessions must survive a restart (a second file at 0600, or
  state handed back over IPC) for a revoke nobody needs yet.
- **C. A code only, the cookie still the token:** leaves the credential in the
  browser's cookie store.
- **D. Keep the token link, collapse slashes only:** leaves the token on argv
  and the audit finding open.

## Consequences

- The API token is no longer on the opener's argv, in `ps`, in shell history or
  in the browser. A code is on argv for at most 60 s, once.
- The session secret is shared by every browser of one `ork ui` and does not
  expire; stopping `ork ui` is the revoke ([G32](../specs/gaps.md)).
- One-time upgrade edge: an older supervisor that starts a newer server sends no
  session, so the open tab's cookie stops working once; browsers signed in
  before the upgrade and old `?token=` links stop working once too. `ork ui`
  signs in again.
- `ui.json` still holds only the token. Ork stores no new credential: the
  session secret is memory only.

Spec: [security](../specs/server/streams-contract-and-security.md#security),
[ork ui](../specs/server/what-it-is-and-ork-ui.md#ork-ui); guide:
[the browser view](../docs/guides/browser-view/starting-and-commands.md).
