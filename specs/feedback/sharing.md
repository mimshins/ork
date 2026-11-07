# Sharing feedback

_Part of [Feedback and self-improvement](../feedback.md)._

**Publishing to Ork's Discussions (opt-in, per item)** (built:
[redact.ts](../../packages/core/src/feedback/redact.ts),
[discussions.ts](../../packages/core/src/feedback/discussions.ts),
[command](../../packages/cli/src/commands/feedback-share.ts),
[tests](../../packages/core/test/publish.test.ts),
[CLI tests](../../packages/cli/test/share.test.ts)):

1. `ork feedback publish <item> [--hide-names]` works only on `ork`-target items
   not published or dismissed already, and only in a terminal.
2. Ork redacts the item:
   - secrets, masked again;
   - absolute paths: the projects its runs came from and every registered one
     rewritten to `<project>/…`, the home folder and any `/Users/<name>` or
     `/home/<name>` to `~`;
   - emails (`<email>`), the hosts of URLs and bare host names by their
     top-level domain (`<host>`, GitHub's kept), IPv4 addresses (`<ip>`); file
     names such as `AGENTS.md` stay;
   - with `--hide-names`, the workflows' and the projects' folders' names
     (`<name>`).
3. Ork adds a structured header: Ork version, driver, model, node type (from the
   newest record), kind, and how often it was seen, then the newest record's
   words quoted (at most 1,500 characters).
4. It reads first, with your `gh`: the category, and its threads, most recently
   updated first, a page of 100 at a time, for one carrying the item's marker.
   Then it shows the exact text it will send, a new thread or a "+1" comment on
   that thread, and asks `y/N`, with no flag to skip it (or Publish in the
   Feedback panel).
5. Only after you confirm does it post, with **your own `gh`**, to the "Agent
   feedback" Discussions category of `mimshins/ork` (slug `agent-feedback`,
   found by slug, never by id). The item becomes `published`.

Deduplication and scale:

- **Fingerprint marker:** every post carries a hidden
  `<!-- ork-fingerprint: … -->` marker.
- **Existing thread:** Ork looks for it first, paging through the category
  (`after:` each page's cursor) until it finds the marker, the threads end, or
  it has read 1,000 of them. If a matching thread exists, it adds a comment with
  the new context and a "+1" instead of a new discussion, so maintainers see one
  thread per real problem, with a count.
- **No backend:** there is no Ork-run telemetry service. Publishing uses your
  account, like every other integration.
- **Adapters:** publish targets are adapters.
  `ork feedback export [--all] [-o file]` and `import <file>` move feedback as
  JSON lines ([jsonl.ts](../../packages/cli/src/runs/jsonl.ts)), so teams can
  share it without GitHub: a line per record (its run, event, time, node and
  report, with `feedbackVersion`), dismissed items' left out without `--all`.
  Import checks each line, masks secrets again, skips a record whose run and
  event are here, and names each bad line; records regroup by fingerprint as
  `new` items ([L151](./limits.md)). An adapter for issues in the project's own
  repository is not part of Ork.
- **Maintainer side (not part of Ork):** triaging the Discussions category, for
  example a scheduled job running the same rules over it and promoting the top
  clusters to issues, is the maintainers' own work.
