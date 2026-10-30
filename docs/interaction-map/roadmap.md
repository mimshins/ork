# Roadmap page

`roadmap.html` beside the maps (`pnpm map`, then **Roadmap** in the top bar, or
`http://localhost:8791/roadmap.html`) shows Ork's milestones, what each holds,
what has shipped and when, and what is left. **Roadmap** lists the milestones
with their items; **Timeline** shows what is ahead, then what shipped, by day.
Click a status to show only those items.

## The data

Everything is in [`public/js/data/roadmap.js`](public/js/data/roadmap.js):
milestones in order, each with its items in build order.

| Item field | What it is                                                          |
| ---------- | ------------------------------------------------------------------- |
| `status`   | `done`, `active`, `next`, `planned`, or `waiting` (on a decision)   |
| `commits`  | the short hashes on `main` that shipped it, oldest first            |
| `date`     | the day it shipped: its newest commit's date (`done` items only)    |
| `docs`     | repository paths, optionally with `#anchor`: the spec, ADR, or code |

A milestone's progress is worked out from its items, never stored.

## Keeping it true

Update the roadmap in the change that ships an item, or right after it (a commit
cannot name its own hash):

1. Set the item to `done`, with its `commits` and `date`.
2. Move `next` to whatever comes after it.
3. Add new work as items; keep each title to a few words.
4. Bump `ROADMAP_UPDATED`.

`pnpm map:check` (part of `pnpm check`) fails when an id repeats, a status is
unknown, a `done` item lacks commits or a date, an unshipped item has a date, a
commit is not on the branch, a date is not the newest commit's, or a doc link is
broken. It also lists every commit on `main` that no item names: add each to an
item, or to `OFF_ROADMAP` (dependency bumps, their merges).
