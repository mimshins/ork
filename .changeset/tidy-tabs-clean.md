---
"@krapht/ork": patch
---

Tab completion and worktrees fixes. Bash completion strips through the last `=`
as well as `:`, so `--input task=` no longer doubles the key; `--input=`,
`--node=` and `--driver=` complete their values; `ork completion zsh | head -1`
exits quietly. A clean detached worktree already on the current branch counts as
merged, so `ork worktrees clean` removes it. The Worktrees panel counts read
`2 worktrees · 4 branches without a worktree`, and the not-a-git-repo message
names the project root and the right verb.
