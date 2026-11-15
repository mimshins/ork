# Next release

_Part of [What's new](../whats-new.md)._

- **A card answered elsewhere says so before the next card.** On a plain
  terminal (`NO_COLOR`, `--plain`), `ork decide --follow` and `ork attach` used
  to print `<id> answered elsewhere: <answer> (<by>)` after the next card's
  `Choose:`, so it read as if that card had been answered. The line now comes
  first.
- **`ork decide --follow` asks several runs' questions in the order they
  opened.** Questions that open in different runs while a card is up now come
  next in the order they opened. Before, they came in the order each run
  happened to be polled. A waiting question answered elsewhere now says
  `<id> answered elsewhere: …` at once, not after the card on screen
  ([decide](../guides/running-workflows/attaching-to-a-run.md#answering-for-several-runs-ork-decide---follow)).
- **`ork attach` asks several runs' questions in the order they opened.** When
  the runs a run called open questions while a card is up, the next card is the
  one that opened first, as in `ork decide --follow`, not the one whose run was
  polled first
  ([attach](../guides/running-workflows/attaching-to-a-run.md#what-it-shows)).
- **A conflict resolver's stray file no longer fails the run.** In the `issues`
  and `resolve-conflict` examples, and this repository's `build` workflow, an
  agent that resolved a conflict but also left a new file outside it (a scratch
  file it has no tool to delete) failed the run at the last step. That file is
  now moved to `ork-strays/` in the checkout's git folder, out of the commit,
  and the log says where; an edit to a tracked file outside the conflict is
  still refused. The resolver no longer has the `Write` tool. Upgrade: to get
  this in a project that took `issues` from `ork init --issues`, run it again,
  or download the example again
  ([conflicts](../guides/issues-in-parallel/locks-and-conflicts.md#a-conflict)).
- **Questions fit a short terminal.** In a pane shorter than a question's card
  (a quarter-screen tmux pane, say), each key press printed the card again below
  the last, so the list filled the pane with copies and the highlighted option
  scrolled out of sight. A question now keeps to the rows the terminal has: only
  the highlighted option keeps its description, the list scrolls around it, and
  the card is cut with "… N more lines" (`d` shows them)
  ([the terminal](../guides/terminal.md#questions)).
