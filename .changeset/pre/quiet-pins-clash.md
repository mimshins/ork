---
"@krapht/ork": patch
---

A sub-agent whose rendered `model` names another driver than its leader's
session now fails the leader's node (`invalid_node`), in `ork run`,
`ork run --node` and `ork chat`, instead of losing the prefix. An empty read in
a sub-agent's model, in a node run alone, is a warning. `ork logs` and the live
stream print `starts a fresh session: driver changed from <from> to <to>` under
the start of a session that began fresh because its driver changed.
