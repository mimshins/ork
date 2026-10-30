# The UI

Status: **Planned** (M2).

**Panels:**

- **Designer:** a React Flow canvas. A palette of node types (Claude leader,
  worker and sub-agent; GitHub; AWS; shell; control; human gate), an inspector
  for each node with a skill picker that shows which layer each skill comes
  from, and a validation overlay. It saves exactly the same YAML and layout
  files.
- **System monitor:** a live graph and ownership tree with status, tokens and
  cost.
- **Chats:** one conversation per node.
- **Decisions inbox:** shaped like the Question tool, with the question, the
  options, the recommended option and one-click answers.
- **Logs:** a filterable event stream.
- **Context inspector:** the resolved layer stack for each node.
- **Feedback:** items grouped by fingerprint and target, with triage, apply,
  accept as a lesson, and the publish preview.

**Style:** dark and dense, inspired by reference image 1.
