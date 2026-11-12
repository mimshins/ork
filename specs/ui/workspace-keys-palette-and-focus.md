# Keys, the command palette and focus

_Part of [The workspace](./workspace.md)._

## Keys

Every combination holds a modifier, so plain typing never fires one (WCAG
2.1.4). They match the physical key, because Option changes the character a key
types on a Mac. The Mac's keys are shown there; elsewhere ⌘ reads Ctrl, ⌥ reads
Alt, ⇧ reads Shift and ⌃ reads Ctrl.

| Keys            | What it does                               |
| --------------- | ------------------------------------------ |
| `⌘K`            | Command palette                            |
| `⌥⇧1` to `⌥⇧9`  | Go to a panel, bringing it back if it must |
| `⌥⇧M`           | Minimize the active panel                  |
| `⌥⇧X`           | Maximize its group, or restore it          |
| `⌥⇧F`           | Float its group, or dock it                |
| `⌥⇧W`           | Close the active panel                     |
| `⌥⇧` + arrows   | Resize its group by 32 px                  |
| `⌃⌥⇧` + arrows  | Move it                                    |
| `⌥⇧]` and `⌥⇧[` | Focus the next or previous group           |

The digits follow the panels' order; a panel past the ninth (Feedback,
Worktrees, Follow-ups) has none, and is reached by **Go to Feedback**, **Go to
Worktrees** or **Go to Follow-ups** in the palette and the Window menu.

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
once the dialog has closed, so it can place focus itself: the palette then
returns no focus of its own, which would land behind a dialog the command
opened, and only a command that leaves the focus nowhere gets it back where the
palette was opened, or in the panels. A command that cannot run stays listed
with its reason.

## Focus

Focus never falls to the page. Going to a panel, restoring it, maximizing and
moving all focus its tab. After a minimize or a close, focus goes to the
selected tab of the group that becomes active; when no panel is left after a
minimize, it goes to that panel's rail button.
