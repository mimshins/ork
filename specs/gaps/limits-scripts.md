# Limits: scripts

_Part of [Known gaps and limits](../gaps.md)._

How a tool node's program works for now, by choice
([ADR-047](../../decisions/ADR-047-script-identity-env-json.md)).

- **L80 · The guards on acting as the user are not a boundary.** `ork chat`,
  `ork continue`, answering with `ork decide` and the sign-in link of `ork ui`
  all refuse when `ORK_RUN` or `ORK_SESSION` is set. But a program or an agent's
  Bash runs as the same user with the same store: it can unset those, read the
  server's token from `~/.ork/ui.json` and call its routes. They stop accidents
  and a prompt-injected "answer your own gate". `ork decide --list` and
  `ork stop` stay open: neither speaks as the user. A real boundary needs
  per-run capabilities.
- **L81 · Only `{{env.*}}` values are scrubbed, and only from tool nodes.**
  Values and pieces under eight characters are not. Nor is anything reshaped
  other than by JSON (up to two levels of it), by line breaks or by picking out
  a JSON value: base64, URL encoding, a change of case, shell quoting, a Unicode
  form, or part of a line. Nor is a secret a program finds on its own; the
  store's patterns still apply to those. A value given as `--input` stays in
  `run.started`, and in a rule's body that reads it. A session inherits the
  user's variables and can print one into its transcript. A run masks what its
  workflow, the workflows it calls by name and its callers read, so a call by a
  computed name is not covered, nor is a called run resumed by hand or from the
  UI, or a message from a program that cleared its environment before
  `ork send`. The price of masking pieces: each line of a multi-line value and
  each value in a JSON one is masked wherever it appears, even as ordinary text.
- **L82 · A masked value stays masked for what reads it.** Live and on resume, a
  `when:` or `{{nodes.…}}` reading `output.json` sees `[masked]`, so a value
  that is not secret needs `plainEnv`. A variable is masked if any node reads it
  without listing it there.
- **L83 · `ORK_BIN` is only set when `ork` can be run directly.** Scripts use
  `"${ORK_BIN:-ork}"`.
- **L85 · A hard kill can leave an unread result on disk.** What a program wrote
  to `$ORK_OUTPUT` is not yet scrubbed. It sits in the run's `.output` folder,
  mode 0700, until the run ends, resumes or is pruned. Ctrl-C, SIGTERM, SIGHUP
  and `ork stop` end a run tidily; `kill -9` or a power cut leaves the file. A
  process that escapes its group can also write there after the node has ended,
  and a folder that cannot be removed stays, with a warning.
- **L86 · A variable a called workflow reads is only a warning.** Whether a call
  runs is often known only at run time, so a run warns and starts, and the call
  fails if reached, after earlier nodes have done their work. A call whose name
  is a template, or whose project is not registered here, gets no warning, and
  nor does a finished call that a loop would run again. A workflow that cannot
  be read gets a warning saying that what it reads is neither checked nor
  masked.
- **L87 · A message can be lost around a crash or an ending.** Each event is
  written on its own, so a crash between `node.finished` and a rule's
  `message.sent` loses that message. A run takes its commands once more before
  `run.finished`, so only a row written after that last look, or a crash before
  it, loses a message `ork send` exited 0 for.
- **L88 · A rule to a template reaches the declared node only.** Instances may
  not exist yet when it fires, so its spawned workers don't get it.
- **L89 · `ork send`'s cap and size are first guesses.** 100 per sending node,
  as for links, and 64 KiB, as for a tool's output. At either it refuses and
  asks nobody.
- **L90 · A tool node can't receive.** It is one shot, so a program has no inbox
  and no `ork inbox`, and `ork send` works only inside a run, not across a link
  or a call.
- **L91 · A message to a node that never runs stays unread.** It starts no
  session, and a branch not taken means no one reads it. The record and
  `ork logs` show it; nothing warns at the end of the run.
- **L92 · A late turn's budget counts a resumed session's whole cost.** A
  session reports its total so far, so a leader that has been re-entered may be
  told nothing is left when some is. The late turn then does not start, and the
  message waits for its next session.
- **L93 · A `before:` default can't be turned off for one node, or read a node's
  output.** A node's own `before:` replaces the default, but nothing removes it.
  It belongs to no node, so it reads only inputs and the run.
- **L94 · A step's kept output can be overwritten.** A long `before:` and
  `verify:` on one node, or two tries of a check, share the run file for their
  cut output, so a path a session was given may later hold the newer output.
- **L95 · `mcp.call` takes the servers it can reach without sign-in.** OAuth and
  SSE servers are refused, so they still take a session. It reads `.mcp.json` at
  the project's root only, not a user's own servers. A server starts for each
  call, and a stdio server's stderr isn't kept.
