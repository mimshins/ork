# Starting it, and what you can do

_Part of [The browser view](../browser-view.md)._

## Starting it

```sh
ork ui              # starts it on http://127.0.0.1:4417 and opens your browser
ork ui --port 4500  # another port, if 4417 is taken
ork ui --no-open    # only print the address and the sign-in link
```

`ork ui` starts Ork's local server and opens it in your browser, already signed
in. Running `ork ui` again opens the one that is running. Ctrl-C stops it; your
runs keep running, and every `ork` command works without it. It uses your own
accounts and asks for none of them.

The sign-in link acts as you, so a program or an agent in a run never gets it in
a store that run guards, `--no-open` included: there `ork ui` says to run it in
your own terminal
([ADR-047](../../../decisions/ADR-047-script-identity-env-json.md),
[ADR-089](../../../decisions/ADR-089-guarded-stores-in-run-identity.md)).

## How it keeps other sites out

It listens only on `127.0.0.1`, and only your browser gets in: `ork ui` opens it
with a one-time link that becomes a cookie, and the server refuses any other
site, any other host name, and any request without it. The link's token is kept
in `~/.ork/ui.json`, readable only by you, and changes each time you start
`ork ui` (a restart from the page keeps it, so the tab stays signed in). If
`ork ui` cannot open a browser (on a server, or without `open` or `xdg-open`),
it prints the link for you to open.

## What you can do, and the command for it

Hover or focus a control to see its command, on its own line under what the
control does. Where the page shows a command, it's a block with a copy button in
its top-right corner.

| In the browser                                  | In a terminal                               |
| ----------------------------------------------- | ------------------------------------------- |
| See your runs                                   | `ork ps`                                    |
| **Run workflow**                                | `ork run <workflow> --detach --input k=v`   |
| See a run's graph and ownership tree            | `ork tree <run>`                            |
| Pause or continue a run                         | `ork pause <run>`, `ork continue <run>`     |
| Pause or continue one node                      | the same, with `--node <node>`              |
| Stop a run, or one node                         | `ork stop <run>`, with `--node <node>`      |
| Read a run's events, filter by a node           | `ork logs <run> --node <node> --follow`     |
| Answer a question                               | `ork decide <run> --id <id> --choose <id>`  |
| Write to a running node                         | `ork chat <run> <node> -m "…"`              |
| Go on with a session whose run ended            | `ork chat <run> <node>` (the terminal only) |
| **Resume…** a run that ended without succeeding | `ork resume <run> --detach`                 |
| See what runs spent                             | `ork usage`                                 |
| See what a node's session loads                 | `ork context explain <workflow> <node>`     |
| Note how a run or a node went                   | `ork feedback note <run> [node] -m "…"`     |
| Read, dismiss or accept feedback                | `ork feedback list`, `dismiss`, `accept`    |
| Make an item a lesson, or a fix                 | `ork feedback accept --lesson`, `apply`     |
| Share an item about Ork itself                  | `ork feedback publish <item>`               |
| Read, close or post a follow-up                 | `ork follow-ups list`, `done`, `post`       |
| Remove or clean up worktrees                    | `ork worktrees remove`, `clean`             |
| Upgrade Ork                                     | `ork upgrade`, then restart `ork ui`        |

Notifications, the theme and the layout belong to the browser and have no
command.

**Run workflow** shows the command it stands for as you fill it in, flags
included. Its **Use this machine's Claude setup** box (your MCP servers and
Claude's memory) is off by default, so the run's sessions start clean; checking
it adds `--machine-claude`
([what a session loads](../running-workflows/running-and-answering.md#what-a-session-loads)).
