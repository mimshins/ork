# Next release

_Part of [What's new](../whats-new.md)._

- **A card answered elsewhere says so before the next card.** On a plain
  terminal (`NO_COLOR`, `--plain`), `ork decide --follow` and `ork attach` used
  to print `<id> answered elsewhere: <answer> (<by>)` after the next card's
  `Choose:`, so it read as if that card had been answered. The line now comes
  first.
