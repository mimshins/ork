# Follow-ups

_Part of [The panels](./panels.md)._

Status: **Built** ([panel](../../packages/ui/src/panels/followups-panel.tsx),
[tests](../../packages/ui/test/panels/followups-panel.test.tsx)), with the
differences listed [at the end](#as-built). The panel for what a change leaves
for later, the twin of
`ork follow-ups list | show | add | done | drop | reopen | due` (the Follow-ups
plan, task 7). Follow-ups are apart from feedback: this panel never lists a
feedback item, and Feedback never lists a follow-up.

It is the eleventh panel, after Worktrees, so it has no Go to digit; its tab
sits after Worktrees in the bottom group. Reach it with **Go to Follow-ups** in
the palette and the Window menu. Its icon is MDI `mdiClipboardCheckOutline`
(`IconFollowUps`, in `icons.tsx` only).

## Contents

- [Layout](#layout)
- [The list](#the-list)
- [An item](#an-item)
- [States and copy](#states-and-copy)
- [Keys, focus and names](#keys-focus-and-names)
- [Tokens](#tokens)
- [As built](#as-built)

## Layout

Same frame as [Feedback](./panels-context-and-feedback.md#feedback): a tools
card, then the list card beside the item card, each scrolling on its own. From
48rem the list takes `minmax(16rem, 2fr)` and the item `minmax(22rem, 3fr)`;
narrower, the item takes the list's place with **Back to follow-ups** (its
heading takes the focus, and `Escape` goes back to its row). Below the list's
least height the whole panel scrolls, so nothing is cut at 200% zoom.

- **Tools card:** **Status**, **For**, **Kind** and, only when more than one
  project has follow-ups, **Project** (`All projects` or one), all `Select`s
  (`Combobox` when **For** holds more than a short list); a summary; **Reload**.
  - **Status:** `Open` (the default: waiting and due, as Feedback's "Not
    dismissed"), `Due`, `Waiting`, `Done`, `Dropped`, `All`. **Kind:**
    `All kinds`, `change`, `message`, `task`, `check`. **For:** `All`, `agent`,
    `me`, then each `project:<name>` and `person:<name>` present. Each option
    carries how many it holds. Filters last for the page's life, and a change
    says its count aloud.
  - **Summary** (mono, muted): "3 due, 5 waiting", or "None due, 5 waiting", or
    "Nothing open".
  - **Reload** reads again, which also checks the PRs follow-ups wait on (the
    server does it on every list read); cli `ork follow-ups list`. The list
    reads when the panel shows, after every action, on Reload, and while it
    shows every 30 s.
- **Checker note:** when the server cannot check PRs, a line with the alert icon
  under the tools: "Can't check PRs: `gh` isn't signed in. After-merge
  follow-ups stay waiting. Run `gh auth login` in a terminal."
- **Nothing is chosen for the person.** No bulk selection, no priorities, no
  assignees (out of scope in the plan).

## The list

Grouped as `ork follow-ups` groups: by **due**, then by **for**.

- **Due groups,** in order: `Now`, `After merge`, `After deploy`, then each date
  ascending (`By 2026-11-20`; a date in the past adds the word "overdue":
  `Overdue · 2026-11-10`). Each is an `<h4>` caption (mono, upper case, muted)
  with its count. The date is a value, so only the words are upper case.
- **For groups** inside each, in order: `agent`, `project:<name>` (by name),
  `me`, `person:<name>` (by name), a mono line in text-muted, as written, never
  upper case, since it is an identifier. Inside a group, `due` before `waiting`
  before `done` before `dropped`, then newest first. Empty groups are not drawn.
- **A row** takes 44 px on two lines, as a feedback row: line one is the title
  and the status; line two is the id (short, mono), the kind, the due word, the
  ref (`#142` or the branch) and when it was added; with the project's name
  first when **Project** is `All projects` and more than one shows.
  - **Status** is a bare badge: `due` (amber, the waiting glyph, "needs you"),
    `waiting` (neutral, the queued glyph), `done` (phosphor, the succeeded
    glyph), `dropped` (neutral, the skipped glyph). A `message` that is done
    says `sent` in place of `done`. A due row also says why in line two when it
    is not the plain case: "PR merged", "overdue 2 d", "closed unmerged".
  - **A done or dropped row** is muted, and its glyph and word still say what it
    is, so nothing rests on the dimming.
  - **The chosen row** is neutral with an outline; amber in the list means due.
- **Its name** is what it shows, in order, with the words only a screen reader
  needs and a pause between the parts, so every seen word is in it (WCAG 2.5.3):
  "Message Acme about the webhook change, due, 4f2a1c, for person:acme-ops,
  message, after merge, #142, added 2 hours ago".
- **One tab stop,** the chosen row (or the first). `ArrowDown`, `ArrowUp`,
  `Home` and `End` move the focus across every group, skipping headings; `Enter`
  or `Space` or a click chooses. Group headings are real headings, so a screen
  reader reaches them by heading.

## An item

The item card, top to bottom:

1. **Heading** (`<h3>`, the title) and its status as a pill, with `sent` for a
   done message.
2. **Actions,** by status. The one that finishes the work is primary (amber)
   only when the item is `due`; the rest are default. A disabled action stays
   focusable and gives its reason in its name and tooltip; the server's answer
   decides, nothing is optimistic. Every action shows its CLI twin.

   | Status  | Actions                                                |
   | ------- | ------------------------------------------------------ |
   | waiting | **Mark due**, **Mark done** or **Mark sent**, **Drop** |
   | due     | **Mark done** or **Mark sent** (primary), **Drop**     |
   | done    | **Reopen**                                             |
   | dropped | **Reopen**                                             |

   `Mark sent` is for a `message`, `Mark done` for the others. Twins:
   `ork follow-ups due 4f2a1c`, `ork follow-ups done 4f2a1c`,
   `ork follow-ups drop 4f2a1c`, `ork follow-ups reopen 4f2a1c`. Drop and Reopen
   don't ask, since Reopen undoes Drop. An `agent` `change` also shows "Done
   when run `4f2a1c` publishes", and "Take it in a run:" with the command
   `ork run start --follow-ups 4f2a1c` as a code block.

3. **A note** (the alert icon, then words) when it came due without a merge:
   "`feature/webhook` was closed without merging, so this is due now. Check it
   still applies, then mark it done or drop it."
4. **Facts:** id with a copy of the whole id, for, kind, due (and the date),
   status, ref as a link to the PR with the external icon, from (run and node
   with **Open run**, named for its run and node), where (files, mono), kept in
   (`Ork's store`, `.ork/follow-ups.md`, or the issue's URL; when GitHub fell
   back: "Ork's store (`gh` was not signed in)"), added and last changed. For
   `project:<name>`, a delivery line: "In `se-frontend`'s list", "Sent to its
   live run `9c1e07` through relay", or "Not delivered: `se-frontend` isn't
   registered. Registered: `se-backend`, `se-frontend`."
5. **Body,** the session's words, shown as the `Markdown` view inside
   `FoldedText` (untrusted text: no HTML, a link allow-list).
6. **Draft** (kind `message`): a card titled "Draft message" with **To**,
   **Channel** (a hint such as `slack`, `email`, `github`) and the text in the
   text well, **Copy message** at the well's top-right. Under it: "Ork never
   sends this. Copy it, send it yourself, then mark it sent." For a `github`
   channel, **Post to GitHub…** too (below).
7. **Steps** (kind `task` or `check`): a numbered list. A text step is a plain
   sentence; a command step is a `CopyCommand` block with its own copy button.
   Above them: "Ork never runs these. Run each yourself, then mark this done."
   There are no ticks: nothing is stored per step.
8. **CLI twin:** `ork follow-ups show 4f2a1c` as a `CopyCommand`.

### Post to GitHub…

A confirm dialog, wide, opening on **Cancel**, that only posts what it shows.

- **Title:** "Post to GitHub?"
- **Description:** "This posts the comment below to `acme/se-backend#142` as
  you, through your `gh`. Ork sends nothing else."
- **Body:** the text in the text well, exactly as it will be sent, and the CLI
  twin as a `CopyCommand` (`ork follow-ups post 4f2a1c`; the CLI task adds it).
- **Buttons:** **Cancel**, **Post comment** (primary). It sends the draft's
  digest, so the server refuses a draft that changed: "The draft changed since
  you opened this. Read it again." and the dialog shows the new text.
- **While it posts,** "Posting…", it can't be closed (Escape included). On
  success it closes, the item becomes `sent`, and a toast says "Posted to
  `acme/se-backend#142`. Marked sent." On failure a line kept for it says "Not
  posted: <gh's words>. Copy the text and post it yourself, or fix `gh` and try
  again.", the item stays as it was, and the focus goes to **Try again**.
  Cancelled, it says "Cancelled. Nothing was posted."
- **Disabled reasons for Post to GitHub…:** "`gh` isn't signed in. Run
  `gh auth login` in a terminal." and, for a channel Ork can't send to, no
  button: "Ork can't send to `slack`. Copy the message and send it yourself."
- **Disabled because of the draft:** when the server's `actions.post` is not ok
  (today: "its `to` isn't a GitHub issue or pull request URL"), the button is
  disabled, stays focusable (`focusableWhenDisabled`) and gives that `why`, the
  same way every other disabled action does. No new pattern, no extra element:
  - **Name** (`aria-label`): `labelOf("Post to GitHub…", post)`, so "Post to
    GitHub…: its `to` isn't a GitHub issue or pull request URL". The reason is
    the server's words, never reworded in the client.
  - **Tooltip:** "Can't post: <the reason>. Copy the message and post it
    yourself." for the draft's reason, since copying is the way out there; for a
    status reason ("it is done"), only "Can't post: <the reason>." Then the CLI
    twin, as for any button. Because the reason is code-shaped, the tip is shown
    through `CodeText` like the note beside it.
  - **Marker:** the panel tells a status refusal from a draft refusal by core's
    `kind` on the refusal (`actions.post.kind`: `status` or `draft`). `why` is
    display text only; changing its wording changes nothing else.
  - **One reason at a time,** the draft's first (Ork can't fix it, so the user
    needs to know before they sign `gh` in), then `gh`: "`gh` isn't signed in.
    Run `gh auth login` in a terminal." The server's `why` stays the source for
    the first; the `gh` one stays the client's.
  - **Nothing else changes:** the draft's **To** fact still shows the stored
    value as given, the **Copy message** button stays the way out, and the
    button never shows an error colour: disabled is the default look, and the
    reason is words (not colour alone).

## States and copy

| State            | What shows                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading          | "Reading follow-ups…" as a polite status, in the list card.                                                                                                                               |
| None at all      | "No follow-ups yet. A run adds one when a change leaves work for later. Add one yourself:" then `ork follow-ups add` as a code block.                                                     |
| Filter leaves 0  | "No follow-ups match. 5 are open, 12 in all. Choose Open or All in Status to see them." (names the filter that shows the rest.)                                                           |
| None due         | The summary says "None due, 5 waiting"; the list shows the waiting ones; the tab has no count.                                                                                            |
| Read failed      | An alert: "Couldn't read follow-ups: <server's words>. Reload, or in a terminal:" then `ork follow-ups list`; **Try again**; the last list stays, dimmed, captioned "From the last read". |
| Action refused   | A toast: "Couldn't mark done: <server's words>". Never a silent no-op.                                                                                                                    |
| No item chosen   | In the wide layout the item card says "Choose a follow-up to read it." and shows nothing else.                                                                                            |
| Disabled action  | Its name ends with the reason; its tooltip says it first, then the CLI twin.                                                                                                              |
| Chosen item gone | The choice clears and says "That follow-up is no longer in this list." (it was dropped from the store or the filter).                                                                     |

All copy follows the [copy rules](./design-components-and-copy.md#copy): the
CLI's nouns, terse, no exclamation marks, commands as code blocks.

## Keys, focus and names

**Keys.** No single-letter shortcut, since the workspace holds every key to a
modifier (WCAG 2.1.4). Inside the panel: arrows, `Home`, `End` in the list;
`Enter` or `Space` to choose; `Tab` to the item card's actions in reading order;
`Escape` closes the dialog, or goes from the item back to its row. The palette
gets **Go to Follow-ups** and **Follow-ups: show due** (sets Status to `Due`,
focuses the list).

**Focus.**

- A status change that **removes the item from the shown list** (Mark done under
  `Open`, Drop) hands the choice and the focus to the next row (the previous if
  it was last, the list card if none is left), as Feedback's Dismiss does.
- A change that **keeps it** (Mark due, Reopen under `All`) puts the focus on
  the item's heading, since the pressed button is replaced by another.
- Copy keeps the focus on its button. Closing the post dialog on success follows
  the rules above; cancelling returns to **Post to GitHub…**.
- **Open run** goes to the Monitor and the run's heading takes the focus, as for
  Feedback.

**Live region** (the workspace's polite one; no panel-local ones but the loading
status and the read failure's alert):

| When              | It says                                                       |
| ----------------- | ------------------------------------------------------------- |
| Copy              | "Copied message.", "Copied command.", "Copied id."            |
| Marked            | "Marked done: <title>." / "Marked sent: <title>."             |
| Dropped           | "Dropped: <title>."                                           |
| Reopened          | "Reopened: <title>, waiting." or "Reopened: <title>, due."    |
| Made due          | "Marked due: <title>."                                        |
| Filter changed    | "7 follow-ups shown." or "No follow-ups shown."               |
| New due on a read | "2 follow-ups came due." (once per read)                      |
| Post              | "Posted to acme/se-backend#142. Marked sent." / "Not posted." |

**Names and roles.**

- The panel starts with the hidden `<h2>` "Follow-ups". The list card is a
  `group` named "Follow-ups" (where the focus lands when the list empties); due
  and for groups are headings; the item card's heading is the `<h3>`.
- **The tab and the rail button** are named "Follow-ups" when none is due and
  "Follow-ups, 3 due" otherwise. The count shows after the title as a mono
  number in amber text, a word-free number that the name spells out; `99+`
  past 99. It reads on page load, every 30 s, and after each action, so it stays
  true with the panel hidden.
- **Selects** are named "Status", "For", "Kind", "Project". **Reload** is named
  "Reload follow-ups". **Copy** buttons say what they copy: "Copy message",
  "Copy command: <command>", "Copy id". The status pill is text, so each row and
  heading says it in words; no state rests on color.
- The **Open run** button is named "Open run 4f2a1c, node review".

## Tokens

No new color, size or layer token, and so no new pairing in
[`pairings.ts`](../../packages/ui/test/pairings.ts): the panel reads the
existing semantic tokens, and its component tokens (`--followups-*`, declared in
its own module, read in the base rule, a state or variant only setting tokens,
[ADR-054](../../decisions/ADR-054-component-tokens.md)) are tested from its own
sheet like every panel's.

| Part              | Tokens                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel, cards      | `--surface-frame`, `--surface-panel`, `--radius-panel`, `--inset-tools`, `--gap`, `--space-3`                                                          |
| Well (draft)      | `--surface-sunken`, `--color-text`, `--font-mono`                                                                                                      |
| Row               | `--color-text`, `--color-text-muted`, `--surface-hover`, `--color-border-strong` for the outline of the chosen row, `--radius-control`, `--text-small` |
| Status: due       | `--color-status-waiting`, the waiting glyph, word "due"                                                                                                |
| Status: waiting   | `--color-status-queued`, the queued glyph                                                                                                              |
| Status: done/sent | `--color-status-succeeded`, the succeeded glyph                                                                                                        |
| Status: dropped   | `--color-status-skipped`, the skipped glyph                                                                                                            |
| Group captions    | `--font-mono`, `--text-caption`, `--color-text-muted`                                                                                                  |
| Tab count         | `--font-mono`, `--text-small`, `--weight-medium`, `--color-action-text`                                                                                |
| Focus             | `--color-focus`, `--focus-width`                                                                                                                       |

The status badge is a `FollowUpStatusBadge` on the same tones as
`ItemStatusBadge`, with no new glyph shape: `due` reuses the waiting shape and
`waiting` the queued one, told apart by word and tone. No side stripes, no text
under 11 px, every target at least 24×24.

## As built

Where the built panel differs from the design above:

- **Take it in a run** reads "Done when a run that takes it publishes." (or
  "Taken by run `4f2a1c`; done when it publishes." once one took it): the
  design's "run `4f2a1c`" was the follow-up's own id.
- **The due count** follows the overview stream's `followUps` event (pushed
  within a second of a change), not a 30 s poll; the list itself reads every 30
  s while the panel is open.
- **Copy** says "Copied." in the button's own status, as every copy button does,
  and does not also go to the workspace's live region.
- **Commands are code blocks, not inline code** (the UI's copy rule): the
  checker note and the failed read say "Run this in a terminal:" / "or in a
  terminal:" and show `gh auth login` / `ork follow-ups list` as blocks, and the
  disabled Post reason names `gh auth login` in plain words.
- **Post to GitHub…** shows `ork follow-ups post 4f2a1c --confirm` as its twin
  (without `--confirm` the CLI only previews). A failed post stays in the
  dialog, whose confirm button is the retry; the focus is not moved to a
  separate **Try again**.
- **For** is a `Select` in every size (no `Combobox` yet), and the "Can't check
  PRs" note names `gh` when any error mentions it, else the server's words.
