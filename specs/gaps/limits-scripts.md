# Limits: scripts

_Part of [Known gaps and limits](../gaps.md)._

How a tool node's program works for now, by choice
([ADR-047](../../decisions/ADR-047-script-identity-env-json.md)).

- **L80 · The `ork chat` guard is not a boundary.** A program or an agent's Bash
  can unset `ORK_RUN` or `ORK_SESSION`, as it runs as the same user with the
  same store. It stops accidents and a prompt-injected "run ork chat". A real
  boundary needs per-run capabilities.
- **L81 · Only `{{env.*}}` values are scrubbed.** Values under eight characters
  are not, nor is a secret a program finds on its own and prints; the store's
  patterns still apply to those.
- **L82 · A stored JSON string is masked.** A resumed run reads the masked value
  of a finished node, so a `when:` comparing one can read differently.
- **L83 · `ORK_BIN` is only set when `ork` can be run directly.** Scripts use
  `"${ORK_BIN:-ork}"`.
- **L84 · The `ork chat` refusal names a command to come.** `ork send` is not
  built yet, so a program in a run has no way to write to a session.
