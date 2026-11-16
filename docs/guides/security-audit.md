# Auditing your project's security

`ork run ork:security-audit` is a security audit of the project you run it in.
It ships with Ork, so there is nothing to download. It reads your code and
reports what it finds; it never changes your project and never runs your code.

It works in a project set up with `ork init`, and it needs a Claude Code login
like any other workflow that runs agents. A run is paid, so start it on purpose.

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
   GitHub workflow files (actions pinned by SHA, `permissions` on each job), and
   a scan of tracked files for credential formats (file, line and pattern name,
   never the value). It also reads your previous audit, so runs build on each
   other.
2. **Agents, all read-only.** One agent maps the project and lists the parts to
   look at. One hunter per part looks for problems, a critic looks for gaps, and
   a fresh verifier per candidate tries to disprove it. Under `standard`, a
   fresh agent checks each confirmed finding again.
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

| File                   | Holds                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `REPORT.md`            | Run, posture, confirmed findings, leads, scanner results, coverage |
| `FINDINGS-DETAIL.md`   | Each confirmed finding of medium severity or above, in full        |
| `NEEDS-VALIDATION.md`  | Each lead with what blocks it and a bounded plan; no severity      |
| `findings.json`        | The final records                                                  |
| `coverage-ledger.json` | The parts looked at, and whether each was hunted or deferred       |
| `run-metadata.json`    | Profile, scope, source ref, and why a run is incomplete            |

Read `REPORT.md` first. **The report may be sensitive: do not commit or post
it.** It describes weaknesses in your code. A real finding belongs in a private
channel, such as your repository's private security advisories.

## Limits

- **`ork init` projects only.** The audit's agents read the workflow's files
  from `.ork/runs/.builtin/<hash>/` in your project. In a project attached with
  `ork register`, Ork's files live outside the checkout, so the first step stops
  with `the audit needs its files inside the checkout; use ork init`, before any
  agent starts and with nothing spent ([projects](./projects.md)).
- A run writes about 350 KB into the project's gitignored `.ork/runs/`. If that
  folder, or `.ork/runs/.builtin`, is a link, Ork refuses to write there.
- The skill it follows is Cloudflare's
  [security-audit skill](https://github.com/cloudflare/security-audit-skill)
  (MIT), shipped inside Ork and pinned to one commit.

For how this repository audits itself, and what each step does in detail, see
the maintainer's [runbook](../../runbook/development/security-audit.md). The
limits Ork knows of are in
[the audit's limits](../../specs/gaps/audit-limits.md).
