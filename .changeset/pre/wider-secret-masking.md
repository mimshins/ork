---
"@krapht/ork": patch
---

Wider secret masking: stored events, feedback and follow-ups now mask npm
tokens, `sk-proj-` and Google keys, Stripe live keys, and the value after
`password`, `token`, `secret` or `api_key` (8 characters or more), and feedback
and follow-ups also mask the values of the run's configured `env:` secrets.
