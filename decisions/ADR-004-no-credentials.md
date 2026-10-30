# ADR-004 — Ork never handles credentials

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** security / integrations
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Ork is a free, local tool. Each user should connect their own accounts: Claude,
GitHub, AWS. The obvious design, an Ork "connect your account" screen that
stores tokens, would make Ork a credential store, and for Claude it would break
Anthropic's terms. Anthropic's legal and compliance page says:

> "Developers building products or services that interact with Claude's
> capabilities, including those using the Agent SDK, should use API key
> authentication through Claude Console or a supported cloud provider. Anthropic
> does not permit third-party developers to offer Claude.ai login into their own
> applications, or to route requests through Free, Pro, or Max plan credentials
> on behalf of their users."

## Decision

1. **Ork stores, proxies, and asks for no credentials.** "Connecting" an account
   means the tool's own login: `claude` (or `ANTHROPIC_API_KEY`, Bedrock,
   Vertex, Foundry), `gh auth login`, `aws sso login` or a profile.
2. **Ork only detects status.** `ork doctor`
   ([checks.ts](../packages/cli/src/doctor/checks.ts)) reports whether each tool
   is installed and signed in, and never prints a token or the account email.
3. **The SDK driver needs an API key or a cloud provider.** It refuses to start
   otherwise ([sdk.ts](../packages/runtime-claude/src/sdk.ts)), so a claude.ai
   login is never routed through Ork's own code.
4. **The CLI driver runs the user's own `claude`**, logged in by the user; Ork
   never reads or passes its credentials. Whether an orchestrator may drive a
   subscription-logged-in `claude` is not clearly covered by the terms; the
   README says so, and the SDK driver with an API key is the clearly supported
   path.
5. **Secrets never reach Ork's records:** logs, events, artifacts, workflow
   files (only `env:` references), and feedback are kept free of them.

## Options considered

- **An Ork account screen that stores tokens.** Convenient; makes Ork a target
  and breaks Anthropic's terms for claude.ai logins.
- **Delegate to each tool's own login** — chosen.

## Rationale

The user already trusts each tool's own login. Delegating keeps Ork out of the
credential business, keeps it within Anthropic's terms, and keeps a compromise
of Ork from leaking anything it never held.

## Consequences

- Setup is "log in to your tools, then `ork doctor`", not an Ork login.
- Contributions must keep this: see [SECURITY.md](../SECURITY.md) and
  [specs/runtime.md](../specs/runtime.md).
