# Reporting Security Issues

Ork runs AI agents and command-line tools on your machine, with your own
accounts (`claude`, `gh`, `aws`). A vulnerability here can let a workflow, an
agent, or a web page do more on that machine than you allowed, so please report
it privately and give us time to fix it before you disclose it.

## How to let us know

Use **GitHub private vulnerability reporting**: open the
[Security tab](https://github.com/mimshins/ork/security) of this repository and
choose "Report a vulnerability". Your report is visible only to the maintainers.

**Do not** put exploit details, proof-of-concept code, keys, tokens, or other
secrets in a public issue, pull request, or comment. This repository is public:
anything posted there is visible to everyone and cannot be taken back.

## What to include (in the private channel)

- What you found, and where (package, file, version or commit).
- How to reproduce it, and what an attacker could do.
- Whether it needs a malicious workflow file, a malicious repository, a
  malicious web page, or none of these.

## Scope

Treat a workflow file someone shares with you as untrusted input. In scope, for
example:

- a workflow file, template, or `when:` expression that runs code or commands it
  should not (the expression language must not reach JavaScript; tool nodes must
  stay within their `allow` list and never go through a shell);
- a workflow or node escaping its working directory, worktree, or `readonly`
  isolation, or reading or writing files outside the project;
- the local server (`ork ui`) reachable from another machine, or usable by a web
  page without its token;
- a credential, token, or other secret written to logs, the event store, run
  artifacts, or a workflow file;
- the build and release supply chain of this repository.

Out of scope: vulnerabilities in Claude Code, the Claude Agent SDK, `gh`, or
`aws` themselves (report them to their maintainers), and what an agent does with
permissions you granted it.

We will investigate all legitimate reports and do our best to fix the problem
quickly.
