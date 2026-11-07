# Limits: design tokens

_Part of [Design system](./design-system.md)._

What the token rule does for now, by choice
([ADR-054](../../decisions/ADR-054-component-tokens.md)). Those the gaps review
carried are open work in the [register](../gaps.md#limits).

- **L130 · A property only a state sets falls back to the browser's style.** Its
  base rule reads `var(--token, revert)`, as there's no value to give it.
  `revert` goes back to the browser's style and skips the page's own defaults in
  [base.css](../../packages/ui/src/design/base.css), such as the color of a
  link. None of today's sheets depends on that, and the computed-style
  comparison found no difference, but a new one could.
- **L131 · Setting another component's token is settled by the cascade.** It's
  specificity and load order, as setting the property was, so it can lose to a
  variant in the other sheet. Only two rules do it today: the Logs filter's
  pressed button, and the builder's card transition.
- **L132 · The rule can't see a modifier class.** It reads selectors, so a class
  used only as a variant, such as `.warning` set from the code, looks like a
  base rule and may set properties.
- **L133 · The contrast check only sees pairs a component declares.** It
  measures a part's `-text` against its own `-bg`. Text on a surface its parent
  draws is covered by the semantic layer's pairings instead, and a pair of two
  different parts isn't checked at all.
- **L134 · There's no check that nothing moved.** The computed-style comparison
  behind [ADR-054](../../decisions/ADR-054-component-tokens.md) was a one-off,
  and isn't in the repository. The next refactor of style sheets has only the
  component tests and a look at the gallery.
- **L135 · Sizes follow the browser's text size, down as well as up.** With a
  browser text size below 16 px, a 24 px target gets smaller than WCAG 2.5.8
  asks, as `--target-min` is now in rem too, and the small wordmark, drawn on
  whole pixels at 15 px high, stops landing on them. At the default size neither
  changes.
- **L136 · Now and node times are only in the browser view.** `ork tree` and
  `--json` still print the tree without them, and a run's elapsed time counts
  waiting on the user. The server folds them
  ([activity.ts](../../packages/core/src/store/activity.ts)), so `ork tree` can
  take them when it's wanted.
- **L137 · The node strip has less than the prototype.** Turns and the worktree
  aren't in the tree, so the strip shows type, model, tokens and what a `watch:`
  is waiting for.
- **L138 · A run's budget shows only on runs from now on.** `run.started`
  records `budgetUsd` from this version, so older runs show what they spent with
  no cap.
