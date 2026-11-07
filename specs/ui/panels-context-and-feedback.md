# Context and Feedback

_Part of [The panels](./panels.md)._

## Context

What the latest chosen node's session loads, layer by layer, as
`ork context explain` prints it
([panel](../../packages/ui/src/panels/context-panel.tsx),
[tests](../../packages/ui/test/panels/context-panel.test.tsx),
[access tests](../../packages/ui/test/panels/context-access.test.tsx)), from the
[node context routes](../server/api.md). It edits nothing.

- **Which node:** the latest chosen anywhere: a run's node from the shared
  selection (the Monitor, Logs, Chats), or the card the person selects in the
  Builder, whose draft it follows, asking again after each edit. A run with no
  node, or none selected in the Builder, says so.
- **The header** names the node (the panel's heading), its type, where it's
  planned from (`review · 4f2a1c`, or `Builder · review · draft`) and the size
  of what Ork appends to its system prompt, with **Reload** and its CLI twin. A
  run's node is planned from the project's files as they are now; a line under
  the header, with its icon beside it, names each file behind it changed since
  the run started ([limits](../gaps/limits-context-inspector.md)). A worker
  spawned in the run is planned as the node it came from, and says so.
- **The stack:** Agent, Project instructions, Skills, Context files, Practices
  and the whole appended system prompt, in the CLI's order, each with its own
  sum (never a total across them, since they don't add up). Each piece is a row
  that opens its words exactly as the session reads them, in monospace, with a
  copy button; it shows whether it's live, its layer, where it comes from and
  its estimated size, and an off piece says why, in the planner's words; a
  lessons file cut at its cap says so, with the whole file's size. A row's name
  is what it shows, in order, with the words only a screen reader needs
  ("layer", "about", "tokens"), so a spoken command can say what's seen.
- **Words:** a node with no session, or a workflow with errors, shows "No
  context to show." and the planner's reason; a failed ask offers **Try again**,
  keeping the answer before it on screen, and the failure is also said through
  the workspace's live region.
- **Focus:** it moves to the node's heading when the shown node changes only if
  the focus was in the panel, and to what the panel says when no node is left;
  it never takes it from the Monitor or the Builder. An opened row sticks to the
  top as its words scroll, and the panel scrolls what takes the focus clear of
  it.

## Feedback

What got in the runs' way, grouped into items, and what a person does with one,
the twin of
`ork feedback list | show | dismiss | restore | accept | apply | publish | split`
([panel](../../packages/ui/src/panels/feedback-panel.tsx),
[tests](../../packages/ui/test/panels/feedback-panel.test.tsx),
[dialog tests](../../packages/ui/test/panels/feedback-dialogs.test.tsx),
[access tests](../../packages/ui/test/panels/feedback-access.test.tsx),
[name tests](../../packages/ui/test/panels/feedback-names.test.tsx)), from the
[feedback routes](../server/api.md). It's the tenth panel, after Context, so it
has no Go to digit; its tab sits after Usage in the bottom group.

- **The list** is every item, most recently seen first, read when the panel
  shows, after every action, on **Reload**, and when the runs change while it
  shows, at most every 5 s (no stream carries feedback,
  [L154](../gaps/limits-feedback.md)). A row is its title and status, then its
  id, how often it was seen, what it's about and its kind, `high` when it is,
  how many were merged into it, and when it was last seen. It's named by what it
  shows, in order, so every word seen is in its name (WCAG 2.5.3), with the
  words only a screen reader needs ("3 times" for `3×`, "last seen") and a pause
  between the parts. It is one tab stop, which is the chosen row (or the first)
  rather than the one last focused; the arrow keys, `Home` and `End` move
  through it. Nothing is chosen for the person.
- **Filters:** Status (Not dismissed, as `ork feedback list` does, All, or one
  status) with how many of everything read each holds, and About (`ork`,
  `workflow` or `project`); they last for the page's life, and a change says the
  count aloud. A filter that leaves nothing says what's missing and which filter
  shows the rest.
- **An item** shows its title (its heading), its status as a pill, its facts (id
  with a copy of the whole fingerprint, about, kind, severity, seen, first and
  last seen, workflows, models, sources, and the items merged into it with
  **Split**), a run proposing a fix for it with **Open run**, its actions, its
  records newest first (when, from whom, a signal's code, the run and node with
  **Open run**, named for its run, node and time so two records' buttons differ;
  a record's own title when it was merged in; its words as written; its
  evidence), and `ork feedback show <id>`. **Open run** goes to the Monitor and,
  once the dock has focused its tab, puts the focus on the run's heading, or
  lets the heading take it when it first draws; the wait ends there, or when
  another run is chosen, so a header drawn again later never takes the focus.
- **Actions** show by what the item is about: Accept, Add lesson…, Propose fix…
  for a workflow or project; Accept and Publish… for `ork`, which says it has no
  lesson or fix; Dismiss or Restore for every item. Whether each is enabled, and
  why not, is the server's answer by core's rule (`feedbackActions`), and for a
  lesson or a fix, where its project is; a disabled one stays focusable and
  gives its reason in its name and tooltip. Nothing is optimistic.
- **Dismiss and Restore** don't ask. An item that leaves the list hands the
  choice and the focus to the next row (the list, when none is left); one that
  stays keeps the focus on its button. **Accept** keeps the focus on its button.
  Refusals are toasts. **Split** says how many came back out.
- **Add lesson…** names the lessons file and its project and how full it is
  against the cap, asks which workflow when there's more than one, prefills the
  item's title, and follows its words in its CLI twin; a refusal (a file over
  the cap) stays in the dialog, and once written a toast says where and its new
  size. Add lesson, like Add note and Post, is described by the reason it waits,
  which is said as it changes.
- **Propose fix…** confirms first, naming the project and that it's a paid run,
  then starts `ork:feedback-apply` with the default driver
  ([L152](../gaps/limits-feedback.md)), goes to the Monitor, and the run's
  heading takes the focus as for **Open run**; a refusal stays in the dialog.
- **Publish…** reads a preview (only reads) and shows exactly what would be
  sent: where it goes (a new thread, or a +1 on the thread that exists, linked),
  the title and text as characters in a well that scrolls and takes the focus,
  and **Hide repository and workflow names** (described by what it hides), which
  reads it again; meanwhile, and after a read that failed, the text before stays
  in view, dimmed and captioned "From the last read". **Post** is never the
  dialog's default; it sends the preview's digest, so the server refuses a text
  that changed, which is then shown to be read again. While it posts it can't be
  closed. A failure fills a line kept for it, so nothing moves; a failed post
  takes the focus to **Try again**, as a failed read does when the focus had
  nowhere to stay. Cancelled, it says nothing was sent.
- **When the chosen item goes** from a read, the choice follows it into the item
  it was merged into, and says so, or clears. Merges are made with
  `ork feedback triage` ([L153](../gaps/limits-feedback.md)).
- **Layout:** from 48rem the list sits beside the item, each scrolling on its
  own; narrower, the item takes the list's place with **Back to items**, its
  heading taking the focus, and `Escape` goes back to its row (as it does from
  the item in the wide layout, once a tip is closed). Below the list's least
  height the whole panel scrolls, so nothing is cut at 200% zoom.
