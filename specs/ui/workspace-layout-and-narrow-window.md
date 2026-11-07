# The saved layout, a narrow window, and limits

_Part of [The workspace](./workspace.md)._

## The saved layout

Saved per browser under `ork.layout.v1`, through the persistence plugin:
dockview's own description of the dock, the rail with each panel's old place,
and the panels folded in the stack. An action saves at once; a mouse change
saves when dockview reports it, a moment later.

A saved layout is checked before use, and one that fails (damaged, or naming a
panel that no longer exists), or that dockview cannot read, gives way to the
default with a toast saying so. **Reset layout** in the Window menu or the
palette restores the default. With browser storage off limits, the layout lasts
as long as the page.

## A narrow window

Below 64rem wide (1024 px at the default text size), which includes a wide
window at 200% zoom, the dock gives way to one column of every panel in the
list's order, each under a heading whose button folds it. The saved dock is
untouched and comes back when the window grows. Commands that need a dock stay
listed and say so. Going to a panel unfolds and focuses it. Crossing that width
keeps what the Builder has open, its selected card and its undo, which live in
the page's [state](./state.md), not in the panel.

## Limits

- **Sizes after several minimizes** ([L33](./limits.md)). One minimize and
  restore comes back exact, as does float and dock. Minimizing several panels
  and restoring them out of order puts each in the right place, but other
  groups' sizes can shift.
- **Keyboard moves are coarser than the mouse** ([L34](./limits.md)). A key
  moves a panel into its neighbor or to an edge; splitting beside one particular
  group takes the mouse, or those two steps.
- **dockview's other skins still ship** ([L35](./limits.md)). Its one style
  sheet holds them, unused.
