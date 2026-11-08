# ADR-068 — A gate's document, and decision text a person can read

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** workflow format, decisions
- **RFC:** waived — the maintainer chose directly on 2026-11-08

## Context

The first canary `feature` run (0427fb01) put a whole task spec, 15,000
characters of Markdown, into its gate's `question`, and the Decisions panel
showed it as raw text. Its last gate had the same problem, with arrays and
objects from reports rendered as one line of JSON. A person answering a gate
needs a short question and something readable to base the answer on.

## Decision

1. `human.gate` takes an optional `document`, a string that supports templates
   exactly like `question`. The question is what is asked; the document is what
   to read to answer. The format change is additive and `schemaVersion` stays 1.
2. The decision record carries `document`, masked like `question` (store
   migration 18), and the API returns it. A blank rendered document is stored as
   none. `ask_user` questions don't set it for now.
3. `decision.opened` does not carry the document. The event log stays small; a
   settled decision's document is read from the store, and a replay still shows
   the question.
4. A gate's `question` and `document` render in a readable mode
   (`renderTemplate(parts, scope, { readable: true })`): a list is `- item`
   lines, a list of objects is one item per object with `key: value` lines, an
   object is `key: value` lines, and anything deeper than two levels is an
   indented code block of pretty JSON. Every other template (a prompt, `env:`)
   keeps JSON ([ADR-047](./ADR-047-script-identity-env-json.md)).
5. The Decisions panel renders the question, context and document as Markdown,
   never as HTML, folds text past about 20 lines behind "Show all", and opens
   the document in a dialog. A terminal stays plain text: `ork decide` prints a
   document of 40 lines or fewer before the question, and otherwise offers it
   with `d`; `--document` prints it.
6. A permission's `context` is the tool's command, path, URL or pattern as
   written, newlines kept, or its input as pretty JSON, cut at 4,000 characters.

## Options considered

- **Render only.** Markdown and folding over the one `question` string. Leaves
  the short ask buried at the end of a long text, and a terminal prints it all.
- **A document field only.** Moves the long text aside, but shows it raw and
  leaves JSON in question text.
- **Both (chosen).** A short question, a document to read, and text that reads
  well wherever a decision is shown.

## Rationale

The question and the material answer different needs, so they are separate
fields; a person can answer without opening the document. Keeping the readable
mode to gates leaves what scripts and prompts read unchanged. Keeping the
document out of events keeps logs small, and the record already holds it.

## Consequences

- A workflow author can write `document: "{{nodes.spec.output.spec}}"` and keep
  the question to a line or two.
- The overview stream sends each open decision whole, so a long document repeats
  on each change ([gaps](../specs/gaps.md)).
- `ork logs` shows the question only.
- A longer permission context makes a leaked secret more likely to be in view;
  masking covers the known token shapes only, as it did before.
