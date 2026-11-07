# The UI

Status: **Built** (M2): its way in, the local server and `ork ui`
([server](./server.md)); and `packages/ui`, the app the server serves, with its
build, its license list and its tests ([ui](../packages/ui/src/app/app.tsx),
[tests](../packages/ui/test/)); the design system's tokens and themes and base
components ([design system](./ui/design-system.md)); and the workspace that
holds the panels ([workspace](./ui/workspace.md)). Its panels are built: Runs,
the Monitor, Logs, Decisions, Chats, Notifications, Usage, Context, the context
inspector, Feedback and Worktrees ([panels](./ui/panels.md)), with a user guide
([the browser view](../docs/guides/browser-view.md)). So is the
[workflow builder](#workflow-builder). The stack is React, Base UI, dockview,
containerized-state and an in-house graph
([ADR-040](../decisions/ADR-040-ui-stack.md)), with Material Design Icons
([ADR-042](../decisions/ADR-042-icons-mdi.md)). The panels read the server's API
through its typed client.

## Contents

- [Design system](./ui/design-system.md)
  - [The language](./ui/design-language.md)
  - [Tokens, themes and type](./ui/design-tokens-and-type.md)
  - [Components and copy](./ui/design-components-and-copy.md)
  - [Limits: design tokens](./ui/design-tokens-limits.md)
- [Workspace](./ui/workspace.md)
  - [The frame and the new-version banner](./ui/workspace-frame-and-banner.md)
  - [The dock and the rail](./ui/workspace-dock-and-rail.md)
  - [Keys, the command palette and focus](./ui/workspace-keys-palette-and-focus.md)
  - [The saved layout, a narrow window, and limits](./ui/workspace-layout-and-narrow-window.md)
- [Panels](./ui/panels.md)
  - [Runs, Run workflow and the Monitor](./ui/panels-runs-and-monitor.md)
  - [The Builder, Logs and Decisions](./ui/panels-builder-logs-and-decisions.md)
  - [Chats, Notifications and Usage](./ui/panels-chats-notifications-and-usage.md)
  - [Context and Feedback](./ui/panels-context-and-feedback.md)
  - [Worktrees](./ui/panels-worktrees.md)
  - [Limits: the context inspector](./ui/panels-context-limits.md)
- [Graph](./ui/graph.md): the layout, its edges in the interaction map's style,
  pan and zoom, and the keys and names that make it accessible.
- [State](./ui/state.md): the containers, streams that stay connected, a run's
  feed and event window, what re-renders, and the preferences.
- [Limits: the browser view](./ui/limits.md)
- [Limits: the workflow builder](./ui/builder-limits.md)

## Panels

- **Workflow builder:** creates a workflow from scratch, or edits one, with no
  YAML to write ([below](#workflow-builder)).
- **System monitor:** a live graph and ownership tree with status, tokens and
  cost.
- **Chats:** one conversation per node.
- **Decisions inbox:** shaped like the Question tool, with the question, the
  options, the recommended option and one-click answers.
- **Logs:** a filterable event stream.
- **Context inspector** (built,
  [Context](./ui/panels-context-and-feedback.md#context)): a read-only panel
  with the resolved layer stack for each node: what it is told, and where each
  piece comes from.
- **Worktrees** (built, [Worktrees](./ui/panels-worktrees.md)): what
  `ork worktrees` lists, for every project, with Remove… one at a time (an
  explicit confirm for what loses work) and Clean merged…, each read then
  confirmed.
- **Feedback** (built,
  [Feedback](./ui/panels-context-and-feedback.md#feedback)): items grouped by
  fingerprint and target, filtered by status and target, with dismiss and
  restore, accept, accept as a lesson, apply (going to the Monitor), split, and
  publish after a preview; a note on a run or a node is written in the Monitor.
  Merging stays `ork feedback triage`'s.
- **New version** (built,
  [the banner](./ui/workspace-frame-and-banner.md#the-new-version-banner)): the
  CLI's notice as a banner, read from the same record, with an upgrade that runs
  `ork upgrade`'s plan after the user confirms, and a restart onto the new
  install ([updates](./cli/updates.md#in-ork-ui)).

## Workflow builder

Status: **Built**, in
[the Builder panel](./ui/panels-builder-logs-and-decisions.md#builder)
([ADR-051](../decisions/ADR-051-workflow-builder.md)).

A user can create a workflow from scratch in the UI, and edit an existing one,
on a canvas, without writing or reading YAML. It saves the same YAML a person
would write, keeping any comments, so a workflow made either way works with
every `ork` command.

- **A palette of node types,** read from the format, so a new type appears with
  no UI work.
- **An inspector for each node and for the workflow,** with forms generated from
  the format's JSON Schema, all the way down, and controls of its own for
  owners, message targets, agents and skills.
- **Conditions from choices:** an edge's `when:` is picked as a field, a test
  and a value from what its source can say, so a value can't be mistyped
  wherever there's a list. It writes the same `when:` a person would, and one it
  can't show stays as written
  ([ADR-052](../decisions/ADR-052-conditions-from-declared-outputs.md)).
- **New edges start valid:** a closed loop gets a condition and rounds, a gate's
  edge its next unhandled answer, and a way out of a loop the opposite of its
  condition. Renaming a value follows into what reads it, and removing one
  that's read is refused.
- **The same checks as `ork validate`,** on the cards, the fields and in a list,
  with what [walking it](./scheduler/walking.md) found and how many ways it
  tried. Errors block a save and warnings never do, and unfinished work stays as
  a draft in the store.
- **A test run** is saving, then a real run through the Run workflow dialog.

## Style

An instrument panel for agents, sized as a console: frames holding cards on a
near-black canvas, lit only where something needs the user; the logo's amber
`#ffb000` as primary (action, attention) and phosphor `#3dff8a` as secondary
(live, done); Geist and Geist Mono; WCAG 2.2 AA in every theme; copy in the
CLI's words. The details are in the [design system](./ui/design-system.md).
