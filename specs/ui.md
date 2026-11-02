# The UI

Status: **Planned** (M2). Its way in is built: the local server and `ork ui`,
with a placeholder page that lists the runs and open decisions live
([server](./server.md)). The panels read the server's API through its typed
client.

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
- **New version:** the CLI's notice as a banner, read from the same record, with
  an upgrade button that runs `ork upgrade`'s plan after the user confirms
  ([updates](./cli/updates.md)).

**Style:** dark and dense, inspired by reference image 1.
