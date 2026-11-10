# Troubleshooting

Start with `ork doctor`: most problems are a missing tool or login, and it says
which.

```sh
ork doctor
```

A node that fails says why in one line;
[why a node stopped](./why-a-node-stopped.md) lists every reason, who acts on it
and what to do.

The pages below list the other messages you are likely to meet, and what to do.
Still stuck? See what a node's session loads with `ork context explain`, rerun
with `--json` for every event, and
[open an issue](https://github.com/mimshins/ork/issues) with the output. Never
paste a token or a key.

## Contents

- [Setup, upgrades and the browser view](./troubleshooting/setup.md)
  - [Setup](./troubleshooting/setup.md#setup)
  - [Upgrading](./troubleshooting/setup.md#upgrading)
  - [The browser view](./troubleshooting/setup.md#the-browser-view)
- [Before a run starts](./troubleshooting/before-a-run.md)
- [During and after a run](./troubleshooting/during-and-after-a-run.md)
  - [During a run](./troubleshooting/during-and-after-a-run.md#during-a-run)
  - [After a run](./troubleshooting/during-and-after-a-run.md#after-a-run)
