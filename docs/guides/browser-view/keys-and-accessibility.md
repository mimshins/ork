# Keys, accessibility, and what it does not do yet

_Part of [The browser view](../browser-view.md)._

## Keys

Everything works from the keyboard. These are the Mac's keys; elsewhere ⌘ is
Ctrl, ⌥ is Alt, ⇧ is Shift and ⌃ is Ctrl.

| Keys                | What it does                                 |
| ------------------- | -------------------------------------------- |
| `⌘K`                | The command palette                          |
| `⌥⇧1` to `⌥⇧9`      | Go to a panel, in the Window menu's order    |
| `⌥⇧M`, `⌥⇧X`, `⌥⇧F` | Minimize, maximize or float the active panel |
| `⌥⇧W`               | Close it                                     |
| `⌥⇧` + arrows       | Resize its group                             |
| `⌃⌥⇧` + arrows      | Move it                                      |
| `⌥⇧]`, `⌥⇧[`        | Focus the next or previous group             |

On the graph, the arrow keys move the view, and on a node they follow its edges.
`Enter` selects a node, `Shift+F10` goes to its controls and `Escape` comes
back; `+` and `-` zoom, and `0` fits the graph. The keyboard button beside the
zoom buttons, **Keys on the graph**, lists them. The node table under the graph,
with what each node is doing now, has the same nodes and actions as a list,
which is often quicker with a screen reader.

## Accessibility

The UI is built to WCAG 2.2 AA: every action works by keyboard, status is never
color alone, and text and focus rings meet its contrast in both themes. It
follows your system's reduced-motion, more-contrast and forced-colors settings.
Changes are announced through one polite live region.

It has been audited with axe and by keyboard in Chrome, but not yet with a real
screen reader or by touch. If something does not work for you, please
[open an issue](https://github.com/mimshins/ork/issues).

## What it does not do yet

- **Runs older than the newest 50** are in `ork ps`.
- **Merging feedback** items is only in the terminal, with
  `ork feedback triage`.

The known limits in full: [the UI's limits](../../../specs/ui/limits.md).
