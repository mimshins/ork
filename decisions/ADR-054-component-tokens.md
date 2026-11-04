# ADR-054 — Each component owns its tokens, and a state only sets tokens

- **Status:** Accepted
- **Date:** 2026-11-05
- **Topic:** UI / design system / how a style sheet is written
- **RFC:** waived: the maintainer decided this directly

## Context

Ork's UI is about to change how it looks. The tokens stopped short of making
that easy. A shared file held about 60 component tokens, and every style sheet
still set properties itself. Of about 1,500 declarations, 564 held raw values,
and a button's hover, its variants and its forced-colors look were each separate
rules that restated `background` or `border-color`. Changing how something looks
meant finding every rule that touched it.

## Decision

**A component declares its own tokens, reads them in one place, and every other
rule only sets tokens.**

```css
.button {
  --button-bg: var(--surface-raised);
  --button-text: var(--color-text);

  background: var(--button-bg);
  color: var(--button-text);
}

.button:hover {
  --button-bg: var(--surface-hover);
}

.button[data-variant="primary"] {
  --button-bg: var(--color-action);
  --button-text: var(--color-text-on-action);
}
```

The rules, each held by
[component-tokens.test.ts](../packages/ui/test/component-tokens.test.ts):

- **A base rule declares and reads.** A component's tokens live in its own CSS
  module, on its base rule, named for it: `--<component>-<part>-<what>`. Shared
  `components.css` is gone.
- **Anything else only sets tokens:** a state, a variant, a rule in an at-rule
  such as forced colors or a container query, and a rule that reaches into
  another component.
- **How a thing looks is always a token.** Color, space, size, corners, type,
  shadow and motion. Only what says how a thing is laid out may be written in
  the base rule, such as `display: flex`, and only while no state changes it.
- **Space, corners, weight and time come from the scale,** and color from the
  semantic layer, so a theme still works. A one-off layout measure, such as a
  dialog's `28rem`, is written in its component's token: naming it
  `--measure-28rem` would say nothing a primitive could add.
- **Every size is in rem, never px, and a line height has no unit,** so the
  whole interface follows the browser's text size. The graph's pan, zoom and
  node positions stay in px, as they're geometry that has to meet the pointer
  and the SVG.
- **One component changes another by setting its token:** a filter's pressed
  button is `.status [aria-pressed="true"] { --button-bg: … }`.
- **Contrast is checked per state.** Each state's text is measured against that
  state's background in every look, read from the sheet, so hand-kept pairings
  now cover only the semantic layer.

**Three layers stay.** The request named primitive and component tokens. The
semantic layer stays between them for color, because it's what makes dark, light
and more contrast one change of attribute. Without it every component would
declare its colors once per look. Spacing and size primitives may be named
directly by a component.

**The focus ring has hooks of its own.** `--focus-ring-width` and
`--focus-ring-offset` are unset, and the page's `:focus-visible` falls back to
the scale when they are. A component sets them for its focus state. Setting
`--focus-width` there would refer to itself and drop the ring.

### Options considered

- **Keep central component tokens, and add more.** Less to migrate, but a
  component's look stays split across two files, and states still set
  properties.
- **Tokens only for what a theme changes.** Smaller, but "change the UI" means
  more than color: density, corners and spacing are what the next look changes.
- **Each component owns everything,** chosen. It's more to read, and it makes
  the next change a matter of values.

## Consequences

- Changing how a component looks is changing values at the top of one file, and
  the test stops a rule from going around that.
- Style sheets are longer. The built CSS grew about 21% before compression.
- The migration was a refactor with no visual change. A codemod did it, and
  every element's computed style was compared before and after: the app and the
  gallery, in every look, with hover, focus and active forced.
- A property only a state sets needs a default for its base rule to read. Some
  read `var(--token, revert)`, which falls back to the browser's style, and
  skips the page's own defaults ([L130](../specs/gaps/limits-tokens.md)).
- A browser text size below the default makes targets and hairlines smaller too
  ([L135](../specs/gaps/limits-tokens.md)).
- A rule from another sheet that sets a component's token is decided by
  specificity and load order, as setting the property was
  ([L131](../specs/gaps/limits-tokens.md)).
