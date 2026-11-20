# Limits found building permissions without asking

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building the shell reader, the shipped reads, refusal, scopes and
suggestions ([permissions without asking](../project-rules/permissions.md),
[ADR-109](../../decisions/ADR-109-permissions-without-asking.md)). What was left
simpler, or could not be checked:

- **L503 · The shipped reads are a list Ork keeps true by hand.** Each program's
  refused forms (`sort -o`, `tail -f`, `jq -f`, …) are written against today's
  flags. A new release of one of them that gains a flag which writes a file or
  runs a program would be allowed until the list learns it. A check that
  compares the list with each tool's `--help` would catch it.
- **L504 · Only shell lines are refused.** The reader reads `Bash` calls only,
  so a read-only node's WebFetch, MCP, `Edit` or `Write` call outside its rules
  still asks a person, even under `unlisted: refuse`; so does a line the reader
  cannot read.
- **L505 · A refused call never becomes a prompt.** A session that keeps
  retrying a refused command is bounded only by its `maxTurns` and the budget,
  by choice; no count of refusals escalates to the person.
- **L506 · Prompts, scopes and suggestions are `claude-code`'s only.** Codex,
  OpenCode, Command Code and omp have no prompt to answer
  ([L234](../gaps.md#limits)): they get no refusal message of Ork's, no scopes,
  no "always" and no suggestions. Their guards now carry the shipped reads
  (Codex, Command Code and omp; OpenCode gets none, L528), and a refused call on
  all four is counted as a `tool.refused` feedback item after 3
  ([capture](../feedback/capture.md)), but not toward a `permission.suggest`.
  `claude-code`'s own refusals are not counted: they are the `permission` tool's
  (L505).
- **L507 · The suggestion threshold is unmeasured.** 3 allows across at least 2
  runs (`suggest-thresholds.ts`) is a first guess; it waits for counts from real
  runs.
- **L509 · `cd` is modelled two levels deep.** The reader follows a `cd` into a
  folder through two link-out passes; three or more levels of `cd` through links
  out of the checkout are not modelled, and such a line asks a person.
- **L510 · A decision's context is cut at 4000 characters.** A longer one is
  shortened in the question; the answer is still read against the full call, so
  a cut context asks again rather than allows, which is safe.
- **L511 · The other drivers' guards read loops, by the whole command.** Codex,
  Command Code and omp check each command of a loop, subshell or `if` against
  the node's rules and the shipped reads, so a loop they refused before runs
  when each of its commands is allowed or a shipped read. They match each
  command as written, wrappers included: `timeout 60 git push` is not caught by
  a deny rule on `git push` there, as it is by the `claude-code` verdict, and
  needs a rule on `timeout` to be allowed. A node in `ork onboard` with no
  `Bash` rule on Codex or Command Code can now run a shipped read such as `ls`.
- **L512 · A generalised rule does not always cover its own source line.** The
  rule offered for `git -C x log` is `Bash(git log *)`, which does not match
  that line, so choosing "always" does not stop the next prompt for that form,
  and a node or run scope allows `git -C <any folder> log` afterwards.
- **L527 · The other drivers' guards do not model `cd`.** Codex, Command Code
  and omp refuse a shipped read on a line that has a `cd`, so `cd x && ls` is
  refused there unless a rule allows each command, where the `claude-code`
  verdict places the paths from each folder the `cd` may reach (L509). Modelling
  `cd` in the embedded source is not built.
- **L528 · OpenCode ships no shipped reads.** The plan was allow globs for the
  programs with no refused form (`cut`, `head`, `tr`, `ls`, `pwd`, `basename`,
  `dirname`, `cd`, `true`, `false`, `ork logs|ps|tree`,
  `ork feedback list|show`, `ork follow-ups list|show`), gated on a check that
  an allowed `ls *` cannot write by redirect while edits are denied. The check
  failed, read from OpenCode 2.3.2's source (not a live run): the shell tool's
  permission resource is the whole command text, redirect included, so `ls *`
  matches `ls > f`; it asks only the `shell` action, no `edit` check on a
  redirect's target; and it runs `external_directory` only for `cd`-style
  commands (`cd`, `chdir`, `pushd`, `popd`, `set-location`, `push-location`), so
  `head *` would also match `head ~/.ssh/x`. No glob ships, and an OpenCode node
  still needs a rule for every shell read. A live run on 2.3.2 would confirm or
  lift this.
- **L529 · A `Read(...)` deny makes the guards refuse every shipped read that
  names a path.** If a node has any `Read(...)` deny rule, the Codex, Command
  Code and omp guards refuse a shipped read that names a path at all, instead of
  matching the deny rule per path as the `claude-code` verdict does. Safe, and
  stricter than needed.
- **L530 · The `tool.refused` threshold is unmeasured.** 3 refusals of one tool
  by one node (`refused-signal.ts`) is a first guess, as L507 is for
  suggestions; it waits for counts from real runs on the four drivers.
- **L531 · OpenCode's own shell allow rules can write by redirect and read
  outside the worktree.** For the reasons in L528, a node's `Bash(head:*)` allow
  rule on OpenCode 2.3.2 matches `head > f` and `head ~/.ssh/x`: the redirect
  writes without an `edit` check, and only `cd`-style commands reach
  `external_directory`. This is older than shipped reads. The "read outside the
  worktree is refused" in [the driver spec](../runtime/open-code.md) was
  measured on 2.1.0 and holds on 2.3.2 for `cd`-style commands only.
- **L532 · A refusal is recognised by its text on three drivers.** Command Code
  and omp mark a result `fault: "refused"` when its text is the guard's
  (`Ork: <tool> is … Do not retry it.`, `Ork refuses …`), and OpenCode when the
  error is `Permission denied: <one word>` or starts with
  `This non-interactive run cannot ask the user for permission, so the request was rejected.`;
  Codex marks its hook's synthetic result and matches no text. A test ties the
  guards' real strings to the recogniser, but OpenCode's wording was read from
  source and not confirmed by a live run, and a reworded guard or OpenCode error
  is not counted until the recogniser learns it. Command Code's own
  `tool_denied` frames (its own rules refusing a call) are not marked refused,
  only the mod's `tool_hook_blocked` ones.
- **L533 · Paths are resolved when the line is decided, not when it runs.** The
  guards, and `claude-code`'s verdict, place each path word of a line before any
  of it runs. Within one line, a command an allow rule covers can create a link
  or change folder first, and a later shipped read then reads somewhere the
  check did not see: with `Bash(ln:*)` allowed, `ln -s /etc x && head x/passwd`
  passes, because `x` was inside the worktree when the line was decided.
  `pushd`, which is not treated as a `cd`, changes folder the same way.
  Modelling the effect of each command before the next is the fix; until then a
  rule for `ln`, `pushd` or the like widens what a shipped read in the same line
  can reach.
