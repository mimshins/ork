# Starting it, and what you can do

_Part of [The browser view](../browser-view.md)._

## Starting it

```sh
ork ui              # starts it on http://127.0.0.1:4417 and opens your browser
ork ui --port 4500  # another port, if 4417 is taken
ork ui --no-open    # only print the address and the sign-in link
```

Running `ork ui` again opens the one that is running. Ctrl-C stops it; your runs
keep running. It uses your own accounts and asks for none of them. How it keeps
other sites and programs out is in
[the browser view's setup](../../getting-started/installation.md#the-browser-view).

## What you can do, and the command for it

Hover or focus a control to see its command, on its own line under what the
control does. Where the page shows a command, it's a block with a copy button in
its top-right corner.

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
| See what a node's session loads       | `ork context explain <workflow> <node>`     |
| Note how a run or a node went         | `ork feedback note <run> [node] -m "…"`     |
| Read, dismiss or accept feedback      | `ork feedback list`, `dismiss`, `accept`    |
| Make an item a lesson, or a fix       | `ork feedback accept --lesson`, `apply`     |
| Share an item about Ork itself        | `ork feedback publish <item>`               |
| Remove or clean up worktrees          | `ork worktrees remove`, `clean`             |
| Upgrade Ork                           | `ork upgrade`, then restart `ork ui`        |

Notifications, the theme and the layout belong to the browser and have no
command.
