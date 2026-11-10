# Limits: the workflow builder

_Part of [The UI](../ui.md)._

What the workflow builder does for now, by choice
([ADR-051](../../decisions/ADR-051-workflow-builder.md),
[ADR-052](../../decisions/ADR-052-conditions-from-declared-outputs.md)). Those
the gaps review carried are open work in the [register](../gaps.md#limits).

- **L103 · A workflow can't be arranged by hand.** Where a card sits follows
  from the nodes and edges, so a workflow drawn badly is a bug in the layout,
  and a new node can move others. If this matters in real use, pins can come
  back with a new RFC.
- **L104 · The builder won't edit through a YAML anchor.** A node or value that
  an anchor shares is refused, as changing it would change another too, and so
  is a rename that would have to follow an id through an alias. It has to be
  replaced in a text editor first.
- **L105 · A hand-written file can change a little where it's edited.** Lines
  nobody edited stay exactly as written, including wrapped text, a file's own
  indent and its line endings
  ([edit-lines.ts](../../packages/schema/src/edit-lines.ts)). The lines an edit
  changes are printed the library's way: an edited `[a, b]` becomes `[ a, b ]`,
  an edited line can lose spaces that lined up its comment, and a line next to
  an edit that the library would print differently, such as `nodes: # note`, can
  change with it. A file the merge can't reproduce exactly, one that mixes
  indents or has four-space nesting with lists at their key's column, is printed
  whole in one style, with its values and comments intact.
- **L106 · The builder checks what `ork validate` checks, not what `ork run`
  does.** Whether a program is installed, a variable set or an MCP server there
  is checked when a run starts.
- **L107 · The builder won't add a second edge between the same two nodes.** The
  format allows two with different conditions, and the builder shows, edits and
  removes each one, but adding one takes a text editor.
- **L108 · Two tabs on one workflow can overwrite each other.** Edits carry no
  version, so a list changed in one tab is replaced by what the other sends. The
  draft is one per workflow, so the last edit wins; nothing is written to the
  file until Save.
- **L109 · A comment at the end of a removed node stays.** The YAML library
  can't say whether a comment there is about the node before it or the one
  after, so removing the node passes it to the next rather than risk losing one
  about that.
- **L110 · A rename stays in its file.** Another workflow's `workflow.call` can
  name this node, and that reference is checked when it runs. A comment or a
  prompt that mentions the old name in words isn't changed either.
- **L111 · A value typed in a free-form field can read as a number.** `1.5` is a
  number and `"1.5"` is text, in fields that hold anything, such as a tool's
  `arguments`. An input's default follows the type the input declares instead.
- **L112 · A declared output is one level deep.** `json.state` can be declared;
  `json.pr.state` stays free text, with no choices and no check, and the same
  goes for a result that isn't an object
  ([ADR-052](../../decisions/ADR-052-conditions-from-declared-outputs.md)).
- **L113 · A renamed value is followed by its text.** Renaming a value changes
  that text in any condition on the node's edges that also reads its field, so
  `choice == 'x' && other == 'x'` changes both. A condition reading the node
  from elsewhere, as `nodes.a.output.choice`, isn't followed, and neither is a
  template ([edit-values.ts](../../packages/schema/src/edit-values.ts)).
- **L114 · A pass-through with several inputs offers no choices.** A router or
  split fed by more than one node can't know what it's passing, so its
  conditions are written by hand. A `workflow.call`'s `outputs` have no choices
  either.
