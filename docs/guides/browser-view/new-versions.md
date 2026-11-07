# New versions

_Part of [The browser view](../browser-view.md)._

When a newer Ork is out, a banner between the top bar and the panels says so,
with what changed and **Upgrade…**. It's the line `ork` prints after a command,
from the same record, and `ork ui` keeps that record fresh on its own while it
runs, at most once a day for your machine
([turning it off](../../getting-started/installation.md#updating)).

**Upgrade…** (or **Upgrade Ork…** in the palette, `⌘K`) does what `ork upgrade`
does, with its question asked by a button:

1. It asks the npm registry now, then shows both versions, the release notes,
   how Ork was installed, and the exact command it would run, such as
   `pnpm add --global @krapht/ork@0.4.0`, with any runs still running. A copy
   from a clone or through `npx` gets the steps to run yourself instead, each
   command in a block to copy, and no run button.
2. **Upgrade to 0.4.0** runs that command on your machine, as you, and shows its
   output as it comes. The dialog stays open until it ends. Stopping `ork ui`
   meanwhile waits for it to finish, so Ork isn't left half-installed; its
   terminal says so, and a second Ctrl-C stops it at once.
3. Once it's installed, **Restart** stops `ork ui` and starts the new one in the
   same terminal, on the same port; the page waits, then reloads itself onto the
   new version, still signed in. Your runs keep running. **Later** leaves it for
   now, and the banner offers **Restart…** until you do.

If the upgrade fails, the dialog shows the output, the exit code and the command
to run in a terminal yourself (a global install that needs more rights is the
usual reason); nothing is restarted. If `ork ui` doesn't come back within a
minute, the page says so: its terminal says why, and `ork ui --port <n>` starts
it again.

**Dismiss for a day** hides the banner for that version, in this browser. A
newer version shows it again at once.

A tab left open across a restart (another tab restarted it, or you did in the
terminal) says its page is from an older Ork and offers **Reload**.
