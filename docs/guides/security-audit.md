# Auditing your project's security

`ork run ork:security-audit` is a security audit of the project you run it in.
It ships with Ork, so there is nothing to download. It reads your code and
reports what it finds; it never changes your project and never runs your code.

It works in a project set up with `ork init` and in one attached with
`ork register`
([how an attached project differs](#in-a-project-attached-with-ork-register)),
and it needs a Claude Code login like any other workflow that runs agents. A run
is paid, so start it on purpose.

## Start it

```sh
ork run ork:security-audit                              # quick, the whole project
ork run ork:security-audit --input profile=standard     # a wider pass
ork run ork:security-audit --input scope="src/server src/auth"
ork run ork:security-audit --input scope=diff:v1.2.0    # the files changed since a ref
```

| Input     | Values                                                       | Default |
| --------- | ------------------------------------------------------------ | ------- |
| `profile` | `quick` (8 hunters) or `standard` (20 hunters and a recheck) | `quick` |
| `scope`   | `all`; project paths separated by spaces; or `diff:<ref>`    | `all`   |

Both inputs are checked by the first step, before anything is spent: a wrong
`profile` fails there, naming the allowed values, and a scope path must stay
inside the project (no absolute path, no `..`).

`ork validate ork:security-audit` and `ork context explain ork:security-audit`
work too, and `ork:` completes to the workflows Ork ships.

## What it costs

Every agent step has its own budget, and the number of steps is limited by the
profile, so the most a run can spend is known up front:

| Profile    | Most it spends | What it covers                                             |
| ---------- | -------------- | ---------------------------------------------------------- |
| `quick`    | $29            | The 8 most important parts of the project: a partial pass  |
| `standard` | $72            | 20 parts, and each confirmed finding is checked a 2nd time |

`quick` is a partial pass, and its report says so. The report also says what a
run could not do, such as leads left unreviewed past the cap.

## What it does

1. **Free scanners (no tokens).** Known advisories in your dependencies, your
   GitHub workflow files (actions pinned by SHA, `permissions` on each job; an
   unpinned action used in several jobs is listed once, with its count), and a
   scan of tracked files for credential formats (file, line and pattern name,
   never the value). It also reads your previous audit, so runs build on each
   other.
2. **Agents, all read-only.** One agent maps the project and lists the parts to
   look at. One hunter per part looks for problems, a critic looks for gaps, and
   a fresh verifier per candidate tries to disprove it. A check then runs the
   skill's validator on each verifier's record, and sends the verifier back with
   what it found (up to 3 tries), so a record that breaks the report schema is
   fixed before it is accepted. Under `standard`, a fresh agent checks each
   confirmed finding again.
3. **A report**, then a question: keep it (`done`) or delete it (`discard`).

Nothing audited is run. Ork has no sandbox for that yet, so a lead that needs
running code is listed as needing validation, with a safe plan for you to follow
by hand.

### Which scanner checks dependencies

The step looks for a lockfile in the project root:

- `pnpm-lock.yaml`: it runs `pnpm audit --json`.
- `package-lock.json`: it runs `npm audit --json`.
- Both: pnpm.
- Neither (yarn, pip, cargo, go and others are not read): the report notes that
  advisories were not checked.

Both need the network. When the scanner fails or you are offline, the run goes
on and the report notes it.

## Where the report is

In `~/.ork/audits/<project>/<run-id>/`, outside your project, so `git status`
stays clean (`<project>` is the main checkout's folder name):

| File                   | Holds                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `REPORT.md`            | Run, posture, confirmed findings, leads, scanner results, coverage                                       |
| `FINDINGS-DETAIL.md`   | Each confirmed finding of medium severity or above, in full                                              |
| `NEEDS-VALIDATION.md`  | Each lead with what blocks it and a bounded plan; no severity                                            |
| `findings.json`        | The final records                                                                                        |
| `coverage-ledger.json` | The parts looked at, and whether each was hunted or deferred                                             |
| `run-metadata.json`    | Profile, scope, source ref, why a run is incomplete, and the previous audit's folder (`prior_run_paths`) |

Read `REPORT.md` first. Its Run section says whether the run is complete; the
posture text names only what was not reviewed, verified or confirmed, so the two
never disagree. **The report may be sensitive: do not commit or post it.** It
describes weaknesses in your code. A real finding belongs in a private channel,
such as your repository's private security advisories.

## In a project attached with `ork register`

An attached project keeps Ork's files outside your repository
([projects](./projects.md)), where the audit's read-only agents cannot read, so
the run works in a temporary copy instead:

- **It audits `HEAD`, the last commit.** `ork run` makes a git worktree of
  `HEAD` beside your clone (`../<clone>-worktrees/ork-<run>-audit-root`), puts
  the audit's files in it, and runs every step there. Your checkout is not
  written to: no file is added to the repository or to `.git/info/exclude`.
- **Uncommitted changes are not audited.** Neither are untracked or ignored
  files such as `.env`. When your checkout has uncommitted changes, the first
  step says so, and the report says so under its notes. Commit first to audit
  them.
- **The report names the audited commit**
  (`audited commit <sha> (a per-run copy of HEAD)`), so you know what it covers.
- **`scope: diff:<ref>` is computed in the copy**, so it is a diff against the
  commit, not your working tree.
- **The copy is removed when the run ends**, whether it finishes, fails, is
  stopped or discarded. `ork resume` makes it again at the same commit, so a
  resumed audit covers the same code. If a crash leaves it, `ork worktrees`
  lists it by the run and `ork worktrees clean` removes it
  ([worktrees](./worktrees.md)). A `post-checkout` hook in your repository runs
  when the copy is made, as for any worktree a run makes.
- `ork validate ork:security-audit` and `ork context explain` pass here too:
  they read the audit's context files from the audit's own folder, with no copy
  made.

An `ork init` project is unchanged: the audit runs in your checkout and reads
your working tree, uncommitted changes included.

## Limits

- **An attached project's audit sees `HEAD`, not uncommitted changes.** See
  above.
- A run writes about 350 KB into the project's gitignored `.ork/runs/`. If that
  folder, or `.ork/runs/.builtin`, is a link, Ork refuses to write there.
- The skill it follows is Cloudflare's
  [security-audit skill](https://github.com/cloudflare/security-audit-skill)
  (MIT), shipped inside Ork and pinned to one commit.

For how this repository audits itself, and what each step does in detail, see
the maintainer's [runbook](../../runbook/development/security-audit.md). The
limits Ork knows of are in
[the audit's limits](../../specs/gaps/audit-limits.md).
