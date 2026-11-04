# The UI

Status: **In progress** (M2). Built: its way in, the local server and `ork ui`
([server](./server.md)); and `packages/ui`, the app the server serves, with its
build, its license list and its tests ([ui](../packages/ui/src/app/app.tsx),
[tests](../packages/ui/test/)); the design system's tokens and themes and base
components ([design system](./ui/design-system.md)); and the workspace that
holds the panels ([workspace](./ui/workspace.md)). Its panels are built: Runs,
the Monitor, Logs, Decisions, Chats and Notifications
([panels](./ui/panels.md)), with a user guide
([the browser view](../docs/guides/browser-view.md)). The
[workflow builder](#workflow-builder) and the context inspector are still to
come. The stack is React, Base UI, dockview, containerized-state and an in-house
graph ([ADR-040](../decisions/ADR-040-ui-stack.md)), with Material Design Icons
([ADR-042](../decisions/ADR-042-icons-mdi.md)). The panels read the server's API
through its typed client.

## Contents

- [Design system](./ui/design-system.md): the language, the three token layers
  and their tests, the themes, type, size and motion, the components and the
  gallery, and the copy style.
- [Workspace](./ui/workspace.md): the frame, the dock and its theme, minimizing
  to the rail, the keys and why they are Ork's own, the command palette, focus,
  the saved layout, and the stack on a narrow window.
- [Panels](./ui/panels.md): the Runs panel, the Run workflow dialog, the
  Monitor, Logs, Decisions, Chats and Notifications.
- [Graph](./ui/graph.md): the layout, its edges in the interaction map's style,
  pan and zoom, and the keys and names that make it accessible.
- [State](./ui/state.md): the containers, streams that stay connected, a run's
  feed and event window, what re-renders, and the preferences.

## Panels

- **Workflow builder:** creates a workflow from scratch, or edits one, with no
  YAML to write ([below](#workflow-builder)).
- **System monitor:** a live graph and ownership tree with status, tokens and
  cost.
- **Chats:** one conversation per node.
- **Decisions inbox:** shaped like the Question tool, with the question, the
  options, the recommended option and one-click answers.
- **Logs:** a filterable event stream.
- **Context inspector:** a read-only panel with the resolved layer stack for
  each node: what it is told, and where each piece comes from.
- **Feedback:** items grouped by fingerprint and target, with triage, apply,
  accept as a lesson, and the publish preview.
- **New version:** the CLI's notice as a banner, read from the same record, with
  an upgrade button that runs `ork upgrade`'s plan after the user confirms
  ([updates](./cli/updates.md)).

## Workflow builder

Status: **Not built.** It needs an RFC first.

A user can create a workflow from scratch in the UI, and edit an existing one,
on a canvas drawn in-house, without writing or reading YAML. It saves exactly
the same YAML and layout files a person would write, so a workflow made either
way works with every `ork` command.

- **A palette of node types:** Claude leader, worker and sub-agent; GitHub; AWS;
  shell; MCP call; workflow call; control; human gate.
- **An inspector for each node,** with its steps and rules (`before:`,
  `verify:`, `notify:`), and a skill picker that shows which layer each skill
  comes from.
- **A validation overlay,** from the same compiler as `ork validate`.

The RFC decides:

- how much of the workflow format the canvas can edit, and what happens to
  fields it can't show;
- how edits round-trip through the YAML without losing comments;
- where node positions are saved;
- how drafts are checked and test-run.

## Style

An instrument panel for agents: a Figma-like dark canvas, dense and quiet, lit
only where something needs the user; the logo's amber `#ffb000` as primary
(action, attention) and phosphor `#3dff8a` as secondary (live, done); Geist and
Geist Mono; WCAG 2.2 AA in every theme; copy in the CLI's words. The details are
in the [design system](./ui/design-system.md).
