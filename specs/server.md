# The local server

Status: **Built** ([server](../packages/server/src/server.ts),
[contract](../packages/server/src/contract.ts),
[client](../packages/server/src/client.ts),
[guards](../packages/server/src/guards.ts),
[`ork ui`](../packages/cli/src/commands/ui.ts),
[tests](../packages/server/test/),
[end-to-end](../packages/cli/test/ui.test.ts)). It serves the built UI
([assets](../packages/server/src/assets.ts)), or a placeholder page when there
is none; the UI's panels are M2 ([ui](./ui.md)). Decided in
[ADR-039](../decisions/ADR-039-local-server.md) and
[ADR-040](../decisions/ADR-040-ui-stack.md).

`@krapht/ork-server` is the way into Ork from a browser: a JSON API with live
event streams, on loopback only. `ork ui` starts it and opens it.

## Contents

- [What it is](#what-it-is)
- [ork ui](#ork-ui)
- [API](#api)
- [Streams](#streams)
- [The contract and the typed client](#the-contract-and-the-typed-client)
- [Security](#security)

## What it is

- **One more client of the store.** The server holds no run. It reads
  `~/.ork/state.db` as `ork ps` does; it writes answers and commands as rows,
  then wakes the run on its socket, as `ork decide`, `ork stop` and
  `ork chat -m` do; and it starts and resumes runs as detached `ork` processes,
  as `--detach` does ([messaging](./messaging.md#reaching-a-live-run)). Closing
  it stops no run. The CLI never goes through it.
- **The same code as the CLI.** Finding a run, the open decisions and answering
  one, stopping and messaging a live run, detaching, resuming and following a
  run's events are core functions (`packages/core/src/remote/`) that both use.
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
  ([open.ts](../packages/cli/src/browser/open.ts)). With `--no-open`, without a
  terminal, or when none starts, it prints the link instead.
- Records `{ port, pid, token, startedAt }` in `~/.ork/ui.json`, mode 0600. A
  second `ork ui` finds the running server there (a record whose pid is gone
  counts as none), opens it, and exits 0.
- Ctrl-C (or SIGTERM) ends the streams, closes the server, removes `ui.json`,
  and exits 0. Runs keep running.

## API

JSON under `/api`. A refusal is `{ "error": "…" }` with the CLI's words. Runs
are named by id or a unique prefix: no match is 404, several are 400.

| Method | Path                          | Does                                                                                               | As                    |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| GET    | `/api/health`                 | `{ version, pid, startedAt }`                                                                      | —                     |
| GET    | `/api/projects`               | the registered projects                                                                            | `ork projects --json` |
| GET    | `/api/projects/:id/workflows` | its workflows folder: each `name`, `file`, `title`, `description`, `inputs`, or `error`            | —                     |
| GET    | `/api/runs`                   | runs newest first, each with `live`; `?project`, `?limit` (20)                                     | `ork ps --json`       |
| GET    | `/api/runs/:id`               | one run, with `live` (`crashed` when its process is gone, `paused` when it is paused) and `paused` | —                     |
| GET    | `/api/runs/:id/tree`          | the ownership tree                                                                                 | `ork tree --json`     |
| GET    | `/api/runs/:id/graph`         | what its graph is drawn from: nodes, edges, channels, positions                                    |
| GET    | `/api/runs/:id/events`        | stored events; `?after`, `?node`, `?limit`, `?last` (the newest N)                                 | `ork logs --json`     |
| GET    | `/api/usage`                  | the [usage report](./usage.md#reports); `?project`, `?workflow`, `?since`, `?until`                |
| GET    | `/api/decisions`              | open decisions of live runs; `?run`, `?project`                                                    | `ork decide --list`   |
| GET    | `/api/decisions/:id`          | one decision, open or not, with its answer and who gave it                                         | `ork logs <run>`      |
| POST   | `/api/decisions/:id`          | `{ choose }`: answers it as `ui`, wakes the run                                                    | `ork decide --id`     |
| POST   | `/api/runs`                   | `{ project, workflow, inputs?, driver?, inPlace?, allowDirty? }`                                   | `ork run --detach`    |
| POST   | `/api/runs/:id/resume`        | `{ inputs?, driver?, inPlace?, allowDirty? }`                                                      | `ork resume --detach` |
| POST   | `/api/runs/:id/stop`          | `{ node? }`: asks a live run, or one running node, to stop                                         | `ork stop`            |
| POST   | `/api/runs/:id/pause`         | `{ node? }`: pauses a live run, or one node                                                        | `ork pause`           |
| POST   | `/api/runs/:id/continue`      | `{ node? }`: lets it go on                                                                         | `ork continue`        |
| POST   | `/api/runs/:id/messages`      | `{ node, body }` to a live run's leader or worker                                                  | `ork chat -m` (live)  |
| GET    | `/api/links`                  | links; `?run=` keeps one run's                                                                     |
| POST   | `/api/links`                  | `{ a, b, maxMessages? }`, as `<run>/<node>`: [links](./messaging/links.md)                         |
| POST   | `/api/links/end`              | `{ a, b }`: ends the link                                                                          |
| GET    | `/api/runs/:id/stream`        | Server-Sent Events, below                                                                          | `ork logs -f`         |
| GET    | `/api/stream`                 | Server-Sent Events, below                                                                          | —                     |
| GET    | `/`, `/assets/…`              | the built UI (below), or the placeholder page without one                                          | —                     |

- **Status codes.** A write that was taken is 202 (start, resume, stop, pause,
  continue, message) or 200 (an answer), with `{ runId }` or
  `{ decision, answer }`. A query or body the contract does not allow, an option
  a decision does not have, or a node without a session is 400; a missing run,
  decision, project, workflow or node is 404; a run in the wrong state (stopping
  one that ended, resuming one that runs or succeeded, messaging one that ended,
  pausing one already paused, continuing one that is not, stopping a node that
  is not running, a decision already answered or withdrawn) is 409
  ([run control](./run-control.md#commands)); a method a path does not take is
  405; a body over 1 MiB is 413.
- **Starting a run.** `project` is a registered project's id or root. `workflow`
  is a name in its workflows folder, or a path inside its root or its Ork
  folder; anything else is 404. The run starts in the project's root, with its
  output in the run's folder (`output.log`), and the answer comes once the run
  is recorded; a run that fails to start answers 400 with its output.
- **A project's workflows** are the `*.ork.yaml` files of its workflows folder
  ([workflows.ts](../packages/server/src/workflows.ts)), each with its declared
  inputs, for starting one; a file that does not parse is listed with its first
  error.
- **Events** are the stored events, already masked; the server sends nothing the
  store does not hold.
- **The built UI** is the first folder that holds an `index.html`: `dist/ui`
  beside the published bundle, or `packages/ui/dist` from source once
  `pnpm ui:build` has run ([folder.ts](../packages/cli/src/browser/folder.ts)).
  `/` is its page; `/assets/…` are its hashed files, cached as immutable; and
  only a file inside the folder of a type the build writes (HTML, JavaScript,
  CSS, fonts, images, text) is served, anything else is 404. Without a built UI
  the placeholder page lists the runs and open decisions live.
- **Messaging a finished run** (resuming its node's session) is not in the API
  yet; it answers 409 and names `ork chat` ([gaps](./gaps.md)).

## Streams

- **A run's stream** (`/api/runs/:id/stream`): `event: run-event` with `id:` the
  event's seq and `data:` the stored event, for each event after `Last-Event-ID`
  (or `?after=`), then each new one as the run stores it; then `event: end` with
  `{ reason }`: `finished`, `crashed` (its process is gone) or `ended`. It
  follows the run's socket when the run has one, and polls the store every 250
  ms when it does not, as `ork logs -f` does (core's `followEvents`). A client
  closes its `EventSource` on `end`; otherwise the browser reconnects, and gets
  `end` again.
- **The overview stream** (`/api/stream`): `event: runs` (the newest 50, with
  `live`) and `event: decisions` (open, of live runs), each sent first and then
  whenever it changes; the store is compared every second. `?project=` narrows
  both.
- Every stream gets a keep-alive comment every 15 s and `retry: 1000`.

## The contract and the typed client

[contract.ts](../packages/server/src/contract.ts) declares each route once: its
method and path, the Zod schemas of its query and body (`strictObject`: an
unknown field is 400), and the type of its answer; and the events of each
stream. The router checks each request against it, and each handler's answer
must have the route's type. [client.ts](../packages/server/src/client.ts) builds
`createClient({ base?, token?, fetch? }).call(route, { params, query, body })`
from it (a body whose fields are all optional may be left out), which returns
`{ ok: true, data }` with the route's type, or `{ ok: false, status, error }`.
The contract imports only `zod` and types, so the UI's browser bundle can use
it; there is no code generation. The browser imports them through
`@krapht/ork-server/client` ([browser.ts](../packages/server/src/browser.ts)),
an entry that re-exports only these two, so nothing from Node reaches the
bundle. The client looks up the global `fetch` on each call unless one is
passed.

## Security

- **Loopback only:** it binds `127.0.0.1`, with no option for another address.
- **Token:** 32 random bytes per start, kept in `ui.json` (0600), never logged
  or stored in events. The link's `?token=` is swapped for an
  `ork_ui_<port>=<token>; HttpOnly; SameSite=Strict; Path=/` cookie with a 302
  that drops it from the address; scripts send `Authorization: Bearer <token>`.
  It is compared in constant time. Without it: 401.
- **Host:** anything but `127.0.0.1:<port>` or `localhost:<port>` is 403 (DNS
  rebinding).
- **Writes:** one signed in with the cookie needs the server's own `Origin`; a
  bearer request without an `Origin` is a script and needs none, but a foreign
  `Origin` is 403 either way (CSRF). A write needs a JSON `Content-Type` (415
  otherwise). No CORS headers are sent.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `no-store`
  (the UI's hashed files are cached as immutable instead). The page has a
  content security policy that allows only the server's own scripts, style
  sheets, fonts, images and connections: no inline script, no inline `<style>`,
  no `eval`, and inline `style` attributes only (`style-src-attr`), which the
  UI's panels, popups and graph position themselves with
  ([page.ts](../packages/server/src/page.ts), ADR-040).
- **What it can do** is what the user's own `ork` can do on the machine: start,
  resume, stop and message runs, and answer decisions. It reads no file outside
  the store and the projects' workflows. Ork still stores, proxies and asks for
  no credentials ([accounts](../docs/guides/accounts.md)).
