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
  `run.started`. A session inherits the user's variables and can print one into
  its transcript. A run masks what its workflow, the workflows it calls by name
  and its callers read, so a call by a computed name is not covered, nor is a
  called run resumed by hand or from the UI, or a run a program starts itself.
  The price of masking pieces: each line of a multi-line value and each value in
  a JSON one is masked wherever it appears, even as ordinary text.
- **L82 · A masked value stays masked for what reads it.** Live and on resume, a
  `when:` or `{{nodes.…}}` reading `output.json` sees `[masked]`, so a value
  that is not secret needs `plainEnv`. A variable is masked if any node reads it
  without listing it there.
- **L83 · `ORK_BIN` is only set when `ork` can be run directly.** Scripts use
  `"${ORK_BIN:-ork}"`.
- **L84 · The `ork chat` refusal names a command to come.** `ork send` is not
  built yet, so a program in a run has no way to write to a session.
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
