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
