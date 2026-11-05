---
"@krapht/ork": minor
---

`ork validate` and `ork run` now stop on a condition that compares a field with
a value it can't have, such as `status == 'failed'` or a gate's `choice` with a
typo, and warn on a condition that's always false, a loop only its rounds can
end, a plain edge beside a loop, and a loop of sessions with no budget or
timeout. `ork run` prints warnings before it starts.
