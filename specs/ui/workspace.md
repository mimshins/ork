# The workspace

_Part of [The UI](../ui.md)._

Status: **Built**, with placeholder bodies in the panels not yet built. The
frame, the dock and its theme, the rail, the narrow stack, the Window menu, the
command palette and the saved layout
([workspace](../../packages/ui/src/workspace/),
[tests](../../packages/ui/test/workspace/)). A browser pass checks what jsdom
cannot: sizes, drawn positions, focus rings and contrast (gap [C6](../gaps.md)).

## The frame

Three rows: a top bar (the mark, **Window**, and **Commands**), the middle, and
a status bar with the [server's state](./state.md#streams-that-stay-connected).
The status bar also holds the workspace's one polite live region, which
dockview's own announcements are routed to.

The panels are one list ([panels](../../packages/ui/src/workspace/panels.tsx)).
The dock, the rail, the stack, the Window menu and the palette all read it, so a
new panel is one entry there.

## The dock

The dock is dockview, on Ork's own theme class: its variables are set from the
design tokens ([dock theme](../../packages/ui/src/workspace/dock.module.css))
and no dockview skin class is applied. The default layout has Runs on the left,
Monitor over Logs and Chats in the middle, and Decisions and Notifications on
the right.

- **A tab** holds an icon and a title and no button, since a control inside a
  tab is invalid. **A group's header** carries Minimize and Close, for its
  selected panel, and Maximize and Float, for the whole group. Each has an
  accessible name, and its keys in its tooltip and in `aria-keyshortcuts`.
- **A floating group** has no Maximize. Its second button docks it again, beside
  the neighbor it left or on that side of the workspace if the neighbor is gone.
  Where a group came from lasts for the page's life; after a reload it docks at
  the right.

Everything else dockview's mouse does (dragging tabs and groups, resizing with
the sashes and the floating window's edges) is dockview's own.

## The rail

Minimizing takes a panel out of the dock, onto a rail of icon buttons at the
workspace's edge, and remembers where it was. Restoring puts it back: in its old
group at its old place if that group is still there; in its floating window's
box if it floated; otherwise beside the neighbor in the split it sat in, at the
size it had. A panel that had a whole column or row beside a branch returns to
that edge of the workspace. The rail takes no room when it is empty.

dockview's own collapsing edge groups were not used: their strip's activators
are in its paid build, and they only work at the workspace's edges.

## Keys

Every combination holds a modifier, so plain typing never fires one (WCAG
2.1.4). They match the physical key, because Option changes the character a key
types on a Mac. The Mac's keys are shown there; elsewhere ⌘ reads Ctrl, ⌥ reads
Alt, ⇧ reads Shift and ⌃ reads Ctrl.

| Keys            | What it does                               |
| --------------- | ------------------------------------------ |
| `⌘K`            | Command palette                            |
| `⌥⇧1` to `⌥⇧6`  | Go to a panel, bringing it back if it must |
| `⌥⇧M`           | Minimize the active panel                  |
| `⌥⇧X`           | Maximize its group, or restore it          |
| `⌥⇧F`           | Float its group, or dock it                |
| `⌥⇧W`           | Close the active panel                     |
| `⌥⇧` + arrows   | Resize its group by 32 px                  |
| `⌃⌥⇧` + arrows  | Move it                                    |
| `⌥⇧]` and `⌥⇧[` | Focus the next or previous group           |

Moving a docked panel takes it into the neighboring group as a tab, or to that
edge of the workspace when there is no neighbor. Moving a floating one shifts
its window by 32 px. dockview's own keys still work in a tab strip: arrows, Home
and End move focus, Enter and Space select, Delete closes.

### Why these keys are Ork's

The keyboard audit of dockview 8.6 found:

- **Sashes take no focus** and have no role or keys. Resizing by key is
  therefore a command on the active group, not a focusable splitter.
- **`keyboardNavigation`** (group focus, tab keys, keyboard docking) is an
  option whose modules ship only in the paid `dockview-enterprise`; without them
  the option does nothing. Ork's commands do the same jobs.
- **The tab overflow control** is a `div` with no role and no keys, so it is
  turned off. Tabs that do not fit scroll, and stay reachable by arrow keys and
  the Go to commands.
- **F6** is left to Base UI's toasts, which use it to reach their region.

A command that cannot run says why, in the palette and through the live region
when its keys are pressed.

No workspace key works while a dialog is open, the palette's own included:
nothing behind a modal changes, and nothing opens over it. Ork's dialogs carry
`data-modal` for this, since a floating panel is a `dialog` to dockview but is
not modal.

## The command palette

A dialog with one search box over every command
([commands](../../packages/ui/src/workspace/commands.ts)). The palette and the
keys read that one list, so they cannot disagree. Type to filter, arrows to
pick, Enter to run, Escape to leave with focus back where it was. A command runs
once the dialog has closed, so it can place focus itself. A command that cannot
run stays listed with its reason.

## Focus

Focus never falls to the page. Going to a panel, restoring it, maximizing and
moving all focus its tab. After a minimize or a close, focus goes to the
selected tab of the group that becomes active; when no panel is left after a
minimize, it goes to that panel's rail button.

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

Below 1024 px wide, which includes a wide window at 200% zoom, the dock gives
way to one column of every panel in the list's order, each under a heading whose
button folds it. The saved dock is untouched and comes back when the window
grows. Commands that need a dock stay listed and say so. Going to a panel
unfolds and focuses it.

## Limits

- **Sizes after several minimizes** ([L33](../gaps/limits.md)). One minimize and
  restore comes back exact, as does float and dock. Minimizing several panels
  and restoring them out of order puts each in the right place, but other
  groups' sizes can shift.
- **Keyboard moves are coarser than the mouse** ([L34](../gaps/limits.md)). A
  key moves a panel into its neighbor or to an edge; splitting beside one
  particular group takes the mouse, or those two steps.
- **dockview's other skins still ship** ([L35](../gaps/limits.md)). Its one
  style sheet holds them, unused.
