# The UI's state

_Part of [The UI](../ui.md)._

Status: **Built**, and read by the status bar and the palette; the panels that
read the rest land next. The containers, the stream links, a run's feed and
event window, and the preferences ([state](../../packages/ui/src/state/),
[tests](../../packages/ui/test/state/)). A run's feed is checked against a fake
server and a fake `EventSource`; the real streams it reads were checked by hand
in a browser, and the feed itself first runs against them when the Logs panel
lands.

## Contents

- [The containers](#the-containers)
- [Streams that stay connected](#streams-that-stay-connected)
- [A run's feed](#a-runs-feed)
- [The event window](#the-event-window)
- [What re-renders](#what-re-renders)
- [Preferences](#preferences)

## The containers

One [containerized-state](../../decisions/ADR-040-ui-stack.md) container per
concern, in [app-state.ts](../../packages/ui/src/state/app-state.ts), reached
through `useAppState()`:

| Container     | Holds                                          | Fed by                  |
| ------------- | ---------------------------------------------- | ----------------------- |
| `runs`        | the newest 50 runs, or null before the first   | the overview stream     |
| `decisions`   | the open decisions, or null before the first   | the overview stream     |
| `connection`  | the stream's state and what `/api/health` said | the stream and `health` |
| `selection`   | the run and the node in view                   | the user                |
| `preferences` | theme, density, desktop notifications          | the user, saved         |
| a run's feed  | its events, in a window                        | that run's stream       |

The workspace's own state (the view, the saved layout, the palette) stays in the
[workspace](./workspace.md). Notifications arrive with their panel.

**The store is the truth** ([ADR-024](../../decisions/ADR-024-event-store.md)).
A write goes through the typed client and comes back on a stream; nothing here
changes a container in advance of the server's word.

## Streams that stay connected

[stream-link.ts](../../packages/ui/src/state/stream-link.ts) wraps
`EventSource`:

- **A dropped connection** is left to the browser, which reconnects and sends
  `Last-Event-ID` by itself.
- **Any answer other than 200** makes the browser give up for good, as while a
  server restarts. The link then opens a new one, after 1 s, doubling up to 15
  s, and back to 1 s after a success. Its URL is read again, since a new
  `EventSource` cannot send that header: a run's stream carries `?after=`.
- **A frame that is not JSON** is dropped, so one bad frame cannot end a stream.

The status bar says what the page knows. `/api/health` is asked at the start, on
each connection and after each failed attempt, so the reason it shows stays
current: a server that went away reads "No answer", and one restarted with a new
token reads "Not signed in". A sign-in from another tab heals the page, since
the attempts never stop. Beside it are the counts of live runs and open
decisions, outside the live region: they change too often to read out.

## A run's feed

[run-feed.ts](../../packages/ui/src/state/run-feed.ts) holds one run's events.

- **It starts from the end.** It reads the newest page with `?last=`, then opens
  the stream after it, so a long run's history is not sent again on every open.
- **Frames gather for 50 ms** and are written together: a burst is one change.
- **A frame at or before the newest seen is dropped,** which is what a reconnect
  can send. A new stream starts after the newest received, written yet or not.
- **`end` closes the stream.** A browser would otherwise reconnect and get `end`
  again. A run the overview then shows live again, as after `ork resume`, is
  read again if a panel still retains it.
- **Retained, not always open.** `useRunFeed(id)` retains a run while a
  component shows it; the last release closes the stream, because a browser
  gives an origin few connections ([L36](../gaps.md)). The four feeds used last
  stay in memory to come back to.

## The event window

[event-window.ts](../../packages/ui/src/state/event-window.ts) is pure. A window
is an unbroken stretch of at most 2000 events, oldest first; reads ask for 500.
Seqs count 1, 2, 3 within a run, so the edges say what lies beyond.

- **While following at the newest,** live events join and the oldest leave.
- **`hold()`** stops them joining, so what is being read holds still; they only
  move `latest`. `follow()` reads the newest page and joins again.
- **`loadOlder()`** reads before the window, by `?after` and `?limit`. Past the
  cap the newest leave, and the window stops following.
- **`loadNewer()`** reads forward from the window's end.
- **Following but behind,** because frames came during a read, the feed reads on
  until it has caught up.

A read that fails keeps the window and sets `error`. A first read that fails is
tried again every second until the feed is stopped.

## What re-renders

Every frame is freshly parsed, so each record in it is a new object even when
nothing in it is new. [reconcile.ts](../../packages/ui/src/state/reconcile.ts)
keeps the old object of a record that did not change, and the old list when
nothing did, which a container takes as no change at all. Components read a
slice with `useComputedValue`.

[render-count.test.tsx](../../packages/ui/test/state/render-count.test.tsx)
holds this down with React's `Profiler`: a change to one run re-renders only
that run's row, a list with nothing new re-renders nothing, 500 frames are one
render, and a slice of a feed ignores changes outside it.

## Preferences

[preferences.ts](../../packages/ui/src/state/preferences.ts) saves the theme,
the density and whether desktop notifications may be sent, per browser
(`ork.preferences.v1`). Values are checked on load: a missing field takes its
default, and values that do not fit are dropped. The app applies them before its
first paint, so a chosen theme flashes only as far as [L32](../gaps.md) says.

The palette's **View** group sets the theme (follow the system, dark, light) and
the density (compact, comfortable); the one in use stays listed and says so.
Desktop notifications are only stored for now; the notification center asks the
browser and reads the value.

The persistence plugin's container is cast once for the React hooks, since the
library's packages each declare `Container` separately ([C7](../gaps.md)).
