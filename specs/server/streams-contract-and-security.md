# Streams, the contract and security

_Part of [The local server](../server.md)._

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
  `live`), `event: decisions` (open, of live runs) and `event: version` (as
  `/api/version`), each sent first and then whenever it changes; they are
  compared every second, the update record read at most once a minute.
  `?project=` narrows the runs and decisions; `?workflow=` narrows the decisions
  only.
- **The upgrade's stream** (`/api/upgrade/stream`): `event: output` per line of
  the package manager's output (`id:` its seq) after `Last-Event-ID` (or
  `?after=`), then each new line, then `event: end`
  ([updates](../cli/updates.md#in-ork-ui)); 404 before any upgrade ran.
- Every stream gets a keep-alive comment every 15 s and `retry: 1000`.

## The contract and the typed client

[contract.ts](../../packages/server/src/contract.ts) declares each route once:
its method and path, the Zod schemas of its query and body (`strictObject`: an
unknown field is 400), and the type of its answer; and the events of each
stream. The router checks each request against it, and each handler's answer
must have the route's type. [client.ts](../../packages/server/src/client.ts)
builds
`createClient({ base?, token?, fetch? }).call(route, { params, query, body })`
from it (a body whose fields are all optional may be left out), which returns
`{ ok: true, data }` with the route's type, or `{ ok: false, status, error }`.
The contract imports only `zod` and types, so the UI's browser bundle can use
it; there is no code generation. The browser imports them through
`@krapht/ork-server/client`
([browser.ts](../../packages/server/src/browser.ts)), an entry that re-exports
only these two, so nothing from Node reaches the bundle. The client looks up the
global `fetch` on each call unless one is passed.

## Security

- **Loopback only:** it binds `127.0.0.1`, with no option for another address.
- **Token:** 32 random bytes per `ork ui`, kept across its restarts, in
  `ui.json` (0600), never logged, stored in events, or put in a process's argv
  or environment. The link's `?token=` is swapped for an
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
  ([page.ts](../../packages/server/src/page.ts), ADR-040).
- **What it can do** is what the user's own `ork` can do on the machine: start,
  resume, stop and message runs, answer decisions, and run `ork upgrade`'s
  package-manager command after the person confirms it in the page. It reads no
  file outside the store and the projects' workflows. Ork still stores, proxies
  and asks for no credentials ([accounts](../../docs/guides/accounts.md)).
