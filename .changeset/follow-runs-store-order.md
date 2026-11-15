---
"@krapht/ork-core": patch
"@krapht/ork": patch
---

`ork logs -f --all`, `ork decide --follow` and `ork attach` now deliver the
events of several runs in the order they were stored (by time, then run, then
sequence), within about one poll, each up to one poll later. With no card up,
`ork decide --follow` asks the earliest opened question first. `ork attach` (and
the called-run view of a foreground `ork run`) interleaves a caller's and its
called runs' events by time; `ork logs <run>` is unchanged.
