# What it is, and ork ui

_Part of [The local server](../server.md)._

## What it is

- **One more client of the store.** The server holds no run. It reads
  `~/.ork/state.db` as `ork ps` does; it writes answers and commands as rows,
  then wakes the run on its socket, as `ork decide`, `ork stop` and
  `ork chat -m` do; and it starts and resumes runs as detached `ork` processes,
  as `--detach` does ([messaging](../messaging.md#reaching-a-live-run)). Closing
  it stops no run. The CLI never goes through it.
- **The same code as the CLI.** Finding a run, the open decisions and answering
  one, stopping and messaging a live run, detaching, resuming and following a
  run's events are core functions (`packages/core/src/remote/`) that both use.
- **Its read handlers serve `ork mcp` too,** Claude Code's tools over stdio,
  without HTTP or a token ([ork mcp](../cli/mcp.md)).
- **One per machine,** serving every registered project; `?project=` narrows a
  list to one, by id or root.
- **`node:http`,** with no framework (ADR-039).

## ork ui

```
ork ui [--port <n>] [--no-open]
```

- Serves on `127.0.0.1:4417`, or `--port` (0 picks a free port). A port in use
  fails with a message that suggests `--port`; it never picks another itself, so
  the browser keeps its cookie.
- Prints the address, then opens the sign-in link (`/?token=…`) in the browser
  through the first opener that starts: `open` on macOS, `wslview` then
  `xdg-open` under WSL, `xdg-open` on Linux
  ([open.ts](../../packages/cli/src/browser/open.ts)). With `--no-open`, without
  a terminal, or when none starts, it prints the link instead.
- Records `{ port, pid, token, startedAt }` in `~/.ork/ui.json`, mode 0600. A
  second `ork ui` finds the running server there (a record whose pid is gone
  counts as none), opens it, and exits 0.
- Ctrl-C (or SIGTERM) ends the streams, closes the server, removes `ui.json`,
  and exits 0. Runs keep running.
- **It supervises the server in a child**
  ([ADR-060](../../decisions/ADR-060-ork-ui-supervises-its-server.md)): the
  launcher it was run as (`process.argv[1]` as given) with `ui --serve`, on the
  same terminal. The port and the token go over the child's IPC channel, never
  argv or the environment; the child writes `ui.json` with its own pid. When the
  page asks for a restart after an upgrade, the child closes and exits, and
  `ork ui` starts the launcher again, now the new install, on the bound port
  with the same token, so the open tab stays signed in. One child at a time;
  Ctrl-C stops it and then `ork ui`, with its exit code. A child whose `ork ui`
  is gone closes too. A new server that doesn't start is reported on the
  terminal with `ork ui --port <n>`. `ork ui --serve` run by hand refuses.
