# Reading without a write: the rule for the audit's agents

Every agent of Ork's security audit (`ork:security-audit`) names this file in
its `context`. Those agents only read: they write nothing and run nothing from
the project.

- Search, read part of a file or see a git diff with extract, and read a whole
  file with Read. Claude Code has no Grep or Glob here unless a node lists them.
- When you do use Bash, keep to cat, head, tail, wc, ls, grep, rg, sed -n, cut,
  sort, uniq, echo and read-only git, one command per call.
- No cd (you are already in the checkout), no awk, no find, no loops, no shell
  variables, no brace expansion, no redirects or files (not even in /tmp) and no
  paths outside this checkout.
- Anything else stops the run to ask the person who started it.
