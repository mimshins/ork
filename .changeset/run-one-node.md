---
"@krapht/ork": minor
---

Add `ork run <workflow> --node <id>`: run one Claude node through the Agent SDK
or your own `claude` CLI, with `--input`, `--driver`, `--in-place` and `--json`.
It streams the transcript, prints the node's report and usage, and asks you on
the terminal when the node has a question or wants a tool its rules leave open.
