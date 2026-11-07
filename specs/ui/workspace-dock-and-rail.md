# The dock and the rail

_Part of [The workspace](./workspace.md)._

## The dock

The dock is dockview, on Ork's own theme class: its variables are set from the
design tokens ([dock theme](../../packages/ui/src/workspace/dock.module.css))
and no dockview skin class is applied. The default layout has Runs on the left,
Monitor and the Builder over Logs, Chats, Usage, Feedback and Worktrees in the
middle, and Decisions and Notifications over Context on the right, so the
Context panel is read beside the Monitor or the Builder without hiding a
decision, Feedback is wide enough for its list beside an item, and Worktrees for
a path on one line.

- **A tab** holds an icon and a title and no button, since a control inside a
  tab is invalid. **A group's header** carries Minimize and Close, for its
  selected panel, and Maximize and Float, for the whole group. Each has an
  accessible name, and its keys in its tooltip and in `aria-keyshortcuts`.
- **A floating group** has no Maximize. Its second button docks it again, beside
  the neighbor it left or on that side of the workspace if the neighbor is gone.
  Where a group came from lasts for the page's life; after a reload it docks at
  the right.

Everything else dockview's mouse does (dragging tabs and groups, resizing with
the sashes and the floating window's edges) is dockview's own.

## The rail

Minimizing takes a panel out of the dock, onto a rail of icon buttons at the
workspace's edge, and remembers where it was. Restoring puts it back: in its old
group at its old place if that group is still there; in its floating window's
box if it floated; otherwise beside the neighbor in the split it sat in, at the
size it had. A panel that had a whole column or row beside a branch returns to
that edge of the workspace. The rail takes no room when it is empty.

dockview's own collapsing edge groups were not used: their strip's activators
are in its paid build, and they only work at the workspace's edges.
