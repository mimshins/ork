# Limits found tying the Builder's problems to its controls

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the tie between a field's problem and its control in the
Builder's inspector
([the For each panel's accessible names](../ui/panels-builder-for-each-checks.md#keys-names-and-tokens)).
What was left simpler:

- **L525 · A problem on a list, record, variant or object group is not tied to
  anything.** A problem is tied to the one control a field draws, with
  `aria-invalid` and `aria-describedby`. A group of fields (a list, a record, a
  variant or an object) has no single control to own the line, so its problem is
  drawn as text beside the group and a screen reader meets it only by reading
  the page, not on focus. Tying it to a labelled group with `aria-describedby`
  would close it.
- **L526 · A problem is read when its control is focused, not when it appears.**
  The line is not a live region: one on every field would speak on each
  keystroke while a value is typed. A person who has just committed a value and
  stays in the field is not told it was refused until they leave and come back.
  Announcing a problem once, when it first appears, is not built. The one
  exception is the For each "Most items" and "Most at once" counts, whose
  problem sits in a `role="alert"` region and is announced when it appears.
