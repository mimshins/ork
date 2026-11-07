# The frame and the new-version banner

_Part of [The workspace](./workspace.md)._

## The frame

Four rows on the canvas: a top bar (the mark, **Window**, and **Commands**), the
[new-version banner](#the-new-version-banner), which takes no room when there is
nothing to say, the middle, whose panels are [frames](./design-language.md), and
a status bar with the [server's state](./state.md#streams-that-stay-connected).
The status bar also holds the workspace's one polite live region, which
dockview's own announcements are routed to. A message empties the region and
fills it on the next tick, so the same words twice are heard twice; it stays for
a second so the next does not cut it off, and what comes meanwhile is said
together after it
([announcer.ts](../../packages/ui/src/workspace/announcer.ts)). The server's
line is quiet while the Upgrade dialog waits for its restart. An action that
says something itself, such as minimizing, keeps dockview quiet while it changes
the dock, so a minimized panel is not also called closed.

The panels are one list ([panels](../../packages/ui/src/workspace/panels.tsx)).
The dock, the rail, the stack, the Window menu and the palette all read it, so a
new panel is one entry there.

## The new-version banner

The CLI's notice, in the page
([update-banner.tsx](../../packages/ui/src/workspace/update-banner.tsx),
[banner-model.ts](../../packages/ui/src/workspace/banner-model.ts)): a frame of
its own between the top bar and the panels, so it never covers work, a `section`
named "New version" that comes after the top bar in reading and Tab order.
Attention is its amber icon and its one primary button, not a tint. What it says
comes from `ork ui`'s [version record](../cli/updates.md#in-ork-ui), in this
order:

| When                                  | It says                                                                | Its button               |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| the page is older than `ork ui`       | "This page is from Ork 0.3.0; `ork ui` now runs 0.4.0."                | **Reload**               |
| an upgrade runs (this tab or another) | "Upgrading Ork to 0.4.0…"                                              | **Show output**          |
| it installed, `ork ui` not restarted  | "Ork 0.4.0 is installed. `ork ui` still runs 0.3.0 until it restarts." | **Restart…**, Dismiss    |
| it failed                             | "The upgrade to 0.4.0 did not finish: exit 1."                         | **Show output**, Dismiss |
| a newer version is known              | "Ork 0.4.0 is out (you have 0.3.0)." and **What changed** (a new tab)  | **Upgrade…**, Dismiss    |

None while the server can't be reached, or with the check off. **Dismiss for a
day** hides it for that version for a day, per browser (the CLI's interval); a
newer version shows at once. It says "Dismissed for a day. Upgrade Ork… is in
Commands." and the focus goes to the panels, as after a close. A banner present
at load isn't news; one that appears while the page is open is said once through
the live region, and the focus never moves to it.

**Upgrade Ork…** (the palette's **Ork** group, always listed) and the banner's
buttons open one dialog
([upgrade-dialog.tsx](../../packages/ui/src/workspace/upgrade-dialog.tsx)) that
walks every step of `ork upgrade`: asking the registry (the focus on Cancel; Try
again hands it there too); the plan, said in the live region as it arrives, with
both versions, the release notes, the installer, its exact command, the runs
still running and `ork upgrade` to copy, or advice, its commands as blocks under
its words, with no run button; **Upgrade to 0.4.0**, never the default; the
package manager's output in a focusable region that follows its end, while the
dialog can't be closed; then **Upgraded to 0.4.0** with **Later** and
**Restart**, or how it failed with the command to run by hand. Restart waits for
a new `ork ui` on the upgraded version, asking `/api/health` every second, and
says "Reloading…" for 1.5 s before it reloads; after a minute, or back on
another version, or signed out, it says why and what to run. Each step's heading
takes the focus as it appears, in the commit that removed what had it, and again
a frame later if the dialog took it back; done and giving up are said aloud too.
Closed before anything ran, it says "Nothing was changed."; closed at all, it
gives the focus to the banner's button, or to the panels when there is none.
