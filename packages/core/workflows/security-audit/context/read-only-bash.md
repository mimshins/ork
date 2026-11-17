# Reading without a write: the rule for the audit's agents

Every agent of Ork's security audit (`ork:security-audit`) names this file in
its `context`. Those agents only read: they write nothing and run nothing from
the project.

- Read files, search and see git output through `extract`. When you do use Bash,
  keep to ls, wc, sort, uniq, cut and echo, one command per call.
- No cd (you are already in the checkout), no awk, no find, no loops, no shell
  variables, no brace expansion, no redirects or files (not even in /tmp) and no
  paths outside this checkout.
- Anything else stops the run to ask the person who started it.
