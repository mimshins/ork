# Limits found building readable gates

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building readable gates
([ADR-068](../../decisions/ADR-068-gate-document-and-readable-text.md),
[the Decisions panel](../ui/panels-decisions-readable.md)):

- **L187 · The Settled list and Logs show decision text as plain.** Only an open
  decision's card renders Markdown. A question in the Settled list or in a run's
  events shows its source lines.
- **L188 · The stream sends whole documents.** The overview stream's `decisions`
  event carries every open decision with its document, so a 15,000-character
  document repeats on each change. There is no `hasDocument` flag with a fetch
  when "Read document" opens. Fine for a few open decisions.
- **L189 · Folding goes by rendered height, and its line count is an estimate.**
  A question folds when it is taller than 20 lines at the card's width. The
  "Show all (N lines)" count comes from that height, so a code block or a
  heading can make it read high or low.
- **L190 · Markdown is a subset.** Tables and task lists show as their source
  lines, and an image shows only its alt text, never loading the image.
- **L191 · A stream's `?workflow=` narrows the decisions only.** Its `runs`
  event stays whole, and the panel filters on its own, in the browser.
- **L192 · An `ask_user` question has no document.** The decision record and
  `HumanQuestion` carry `document`, but only `human.gate` sets it, so `d` and
  "Read document" apply to gates alone.
- **L193 · The document dialog closes if its decision settles.** The dialog
  lives in its card, so when another terminal answers the decision, the card
  goes and the dialog with it, rather than keeping its text until it is closed.
- **L194 · The filter selects have no CLI-twin tooltip.** Their CLI twin,
  `ork decide --list --workflow <name>`, shows only in the filtered empty state.
