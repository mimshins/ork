# Reading without a write: the rule for read-only nodes

A node that only reads (a reviewer, the `split` step of `qa-pass`) names this
file in its `context`, after the project's [session rules](./sessions.md).

- Read files with Read and search with Grep.
- When you do use Bash, keep to cat, head, tail, wc, ls, grep, rg, sed -n, cut,
  sort, uniq, echo and read-only git, one command per call.
- No cd (you are already in the checkout), no awk, no find, no loops, no shell
  variables, no brace expansion, no redirects or files (not even in /tmp) and no
  paths outside this checkout.
- Anything else stops the run to ask the maintainer.
