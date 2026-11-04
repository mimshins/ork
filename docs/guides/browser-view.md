# The browser view

`ork ui` shows your runs in your browser: what is happening, what is waiting on
you, and what each node has said. It reads and writes the same store as the
`ork` command, so a run started in one shows up in the other, and every action
here has a command that does the same. The contract is the
[UI spec](../../specs/ui.md).

![Ork's workspace: the Runs panel, the Monitor with a run's graph and ownership tree, Logs below it, and an open decision in the Decisions panel.](./images/browser-view-dark.png)

## Starting it

```sh
ork ui              # starts it on http://127.0.0.1:4417 and opens your browser
ork ui --port 4500  # another port, if 4417 is taken
ork ui --no-open    # only print the address and the sign-in link
```

Running `ork ui` again opens the one that is running. Ctrl-C stops it; your runs
keep running. It uses your own accounts and asks for none of them. How it keeps
other sites and programs out is in
[the browser view's setup](../getting-started/installation.md#the-browser-view).

## What you can do, and the command for it

Hover or focus a control to see its command, and copy it where one is shown.

| In the browser                        | In a terminal                               |
| ------------------------------------- | ------------------------------------------- |
| See your runs                         | `ork ps`                                    |
| **Run workflow**                      | `ork run <workflow> --detach --input k=v`   |
| See a run's graph and ownership tree  | `ork tree <run>`                            |
| Pause or continue a run               | `ork pause <run>`, `ork continue <run>`     |
| Pause or continue one node            | the same, with `--node <node>`              |
| Stop a run, or one node               | `ork stop <run>`, with `--node <node>`      |
| Read a run's events, filter by a node | `ork logs <run> --node <node> --follow`     |
| Answer a question                     | `ork decide <run> --id <id> --choose <id>`  |
| Write to a running node               | `ork chat <run> <node> -m "…"`              |
| Go on with a session whose run ended  | `ork chat <run> <node>` (the terminal only) |
| Resume a stopped or crashed run       | `ork resume <run>` (the terminal only)      |
| See what runs spent                   | `ork usage`                                 |

Notifications, the theme and the layout belong to the browser and have no
command.

## The panels

**Runs** lists the newest 50 runs, filtered by project if you choose one, with
each one's status and cost. Choosing a run opens it in the other panels. **Run
workflow** asks for a project, a workflow and its inputs, shows the command as
you fill them in, and says why it cannot start yet. Once started, the focus goes
to the new run in the Monitor. If your projects have
[triggers](./watching.md#starting-a-run-when-something-happens), they're listed
under the runs, with whether each is live. Accepting one takes a terminal.

**Monitor** draws the run as it goes, beside the same nodes as a tree. Each node
shows its status, cost, tokens and model. Select a node for its own controls.
Stopping asks first and says what will happen: a stopped node fails, and the
workflow's failure rules apply; a stopped run can be resumed. A node that called
another workflow links to that run, and one that's
[watching a source](./watching.md) says what it's waiting for and how often it
looks.

**Logs** shows a run's events. It stays on the newest; scroll up and it holds
still, and **Follow** counts what is new. Filter by node, by event type or by
text. Filters look through what is loaded, and **Load older** reads more. Open a
row for the whole event.

**Decisions** collects every open question from every run. Answer with one
click, or with the focus in a card press `1` to `9`, or `Enter` on the card for
the recommended option. A card stays until the run has taken the answer, and if
it is refused it says why. Below, **Settled** says who answered what, including
from a terminal.

**Chats** keeps one thread per leader or worker, with what it said, what you
said, and what it did in between. While the run is live, `Enter` sends and
`Shift+Enter` starts a new line. Once the run has ended, it gives you the
`ork chat` command, which picks that session up in your terminal.

**Notifications** lists open decisions and runs that ended, crashed or paused,
and the bell in the top bar counts what is unread. What you have read is kept
per browser. Desktop notifications are off until you turn them on here, which
makes your browser ask.

**Usage** shows what runs spent over a period, for a project or all of them:
totals, spend per day, and the costliest workflows, models and nodes, with what
is worth a look. See [what you spent](./models-and-budgets.md#what-you-spent).

### Builder

Creates or edits a workflow, with no YAML to write. Choose a project, then a
workflow, or type a new name and choose **Create**.

- Add a node from the list on the left. The canvas arranges itself from the
  nodes and their edges, so there's nothing to drag.
- Select a card to fill it in on the right. With nothing selected, the same
  place has the workflow's own settings.
- To connect two nodes, select the first, then use **Connect to**, or **Pick a
  card** and choose the next one.
- An edge's condition is a choice: when it succeeds, when it fails, or when a
  test holds, picked as a field, a test and a value from what that node can say.
  A tool's JSON has choices once it declares them, and **Add a field** does that
  from the condition. A condition these can't show stays as you wrote it, under
  **Written by hand**.
- A `watch:`'s **until** is chosen the same way, from what the node declares.
- A new edge starts valid. Closing a loop fills in a condition and a limit on
  rounds, and a gate's edge takes its next answer. Under a gate, it says which
  answers end the run.
- Renaming an option or a declared value follows into the conditions that read
  it. Removing one that's read is refused, and it names the edge to change
  first.
- What the checks say shows on the cards, on the fields and under the canvas.
  They're the same checks as `ork validate`.
- What you change is kept as a draft, so closing the tab loses nothing, and your
  workflows folder only gets it when you choose **Save**, which needs no errors
  left. Save never commits.
- **Run…** saves and opens Run workflow. It's a real run: it can spend money,
  and commit work. Before it starts, it names the nodes that act outside the
  worktree.

The file it saves is the one you could write by hand. Lines you didn't edit stay
exactly as written, comments included. Cards have no saved positions, so a
`<name>.layout.json` from an older version is ignored and can be deleted.

## The workspace

Drag a tab to dock it beside or into another group, or use the buttons on each
group to minimize it to the rail, maximize it, float it or close it. The layout
is saved in your browser, and **Reset layout** in the palette brings the default
back. Below about 1024 px wide the panels stack, and each one folds.

The command palette, `⌘K` or `Ctrl K`, runs everything by name: going to a
panel, the theme, the density, starting a run.

![The same workspace in the light theme.](./images/browser-view-light.png)

## Keys

Everything works from the keyboard. These are the Mac's keys; elsewhere ⌘ is
Ctrl, ⌥ is Alt, ⇧ is Shift and ⌃ is Ctrl.

| Keys                | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `⌘K`                | The command palette                                  |
| `⌥⇧1` to `⌥⇧6`      | Runs, Monitor, Logs, Decisions, Chats, Notifications |
| `⌥⇧M`, `⌥⇧X`, `⌥⇧F` | Minimize, maximize or float the active panel         |
| `⌥⇧W`               | Close it                                             |
| `⌥⇧` + arrows       | Resize its group                                     |
| `⌃⌥⇧` + arrows      | Move it                                              |
| `⌥⇧]`, `⌥⇧[`        | Focus the next or previous group                     |

On the graph, the arrow keys move the view, and on a node they follow its edges.
`Enter` selects a node, `Shift+F10` goes to its controls and `Escape` comes
back; `+` and `-` zoom, and `0` fits the graph. The ownership tree beside it has
the same nodes and actions as a list, which is often quicker with a screen
reader.

## Accessibility

The UI is built to WCAG 2.2 AA: every action works by keyboard, status is never
color alone, and text and focus rings meet its contrast in both themes. It
follows your system's reduced-motion, more-contrast and forced-colors settings.
Changes are announced through one polite live region.

It has been audited with axe and by keyboard in Chrome, but not yet with a real
screen reader or by touch ([L70](../../specs/gaps/limits.md)). If something does
not work for you, please
[open an issue](https://github.com/mimshins/ork/issues).

## What it does not do yet

- **Showing what a node loads.** The context inspector is still to come. For
  now, use `ork context explain`.
- **Resuming a run** has no button ([L71](../../specs/gaps/limits.md)).
- **Runs older than the newest 50** are in `ork ps`.

## Next

[Running workflows](./running-workflows.md): the same runs from the terminal.
