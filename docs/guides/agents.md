# Agents

An **agent** is who does a Claude node's work: its role, its model, the tools it
may use, what it reports. A **node** is a place in the flow: its task, its
owner, its edges. Define an agent once, and any node can take it. The contract
is in the [workflow format](../../specs/workflow-format.md#agents) and
[context](../../specs/context.md#agents) specs.

## A node that takes an agent

```yaml
nodes:
  approver:
    type: claude.worker
    agent: approver # who does the work
    prompt: Decide whether {{nodes.builder.output.branch}} is ready to merge.
```

The `prompt` is the agent's task for this node. Anything you set on the node
wins over the agent: give the same `reviewer` agent `model: opus` on one node
and leave it on the agent's model on another. A node without `agent` is a plain
node and works as before.

The agent's role is added to the node's system prompt as `# Your role: <name>`.
Its output fields can be read by the node's edges: an approver agent with
`output: { schema: { verdict: [approve, escalate] } }` lets
`when: verdict == 'approve'` work on any node it fills.

## Where agents come from

From lowest to highest precedence, when two have the same name:

| Where                         | Files                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **You**                       | `~/.ork/agents/<name>.md`                                                                |
| **Your project's tools**      | `.ai/agents/`, `.opencode/agents/`, `.claude/agents/`: what Claude Code and OpenCode use |
| **Your project's Ork agents** | `.ork/agents/<name>.md`                                                                  |
| **The workflow**              | its own `agents:` section                                                                |

Your project's existing agents work as they are: if `.claude/agents/reviewer.md`
exists, a node can say `agent: reviewer`. Linked folders are followed, so a
project that keeps one `.ai/agents/` folder and links `.claude/agents` and
`.opencode/agents` to it has each agent once.

```console
$ ork agents list
documenter   project  .ai/agents/documenter.md (via .opencode/agents, .claude/agents)  Use when turning PRDs …
implementer  project  .ai/agents/implementer.md (via .opencode/agents, .claude/agents)  Use when writing …
reviewer     project  .ai/agents/reviewer.md (via .opencode/agents, .claude/agents)  Use when reviewing …
```

`ork agents show <name>` prints one in full; `ork context explain <wf> <node>`
names the agent that fills a node.

## An agent's files

An agent is a markdown file every tool can read, plus an optional file of Ork's
settings beside it:

```markdown
---
name: approver
description: Decides whether a reviewed branch is ready to merge.
---

You approve merges. Approve when it meets its spec and the reviews passed;
escalate to a human when anything is doubtful. Say why.
```

```yaml
# approver.agent.yaml: Ork's settings, which other tools never see
model: opus
isolation: readonly
output:
  schema:
    verdict: [approve, escalate]
```

The settings file takes what a Claude node takes: `model`, `effort`, `driver`,
`skills`, `context`, `isolation`, `budgetUsd`, `maxTurns`, `practices`, `tools`
and `output`. Paths in `skills` and `context` are relative to the agent's own
folder. A Claude Code `model:` in the markdown is used too; the settings file's
wins.

Ork's settings live in their own file, not in the markdown's frontmatter,
because OpenCode sends unknown frontmatter keys to the model provider.

## Adding and removing agents

```console
$ ork agents add approver --description "Decides whether a branch is ready to merge." --model opus
created .ork/agents/approver.md
created .ork/agents/approver.agent.yaml
$ ork agents add reviewer --from reviewer --model opus   # copy a project agent into .ork/agents
$ ork agents rm approver
```

`--user` uses your own `~/.ork/agents/` instead. A new agent's role starts as
"You are <name>." and its description: edit the markdown to write the real one.
Ork writes only its own folders (`.ork/agents/`, `~/.ork/agents/`), never a
tool's folder such as `.claude/agents`.

## Agents in a workflow file

A workflow can define its own agents, which win over every other source and
travel with the file:

```yaml
agents:
  security-reviewer:
    description: Reviews a branch for security issues.
    instructions: You review for security … Report changes_requested or pass.
    model: opus
    isolation: readonly
```

Both [examples](./examples.md) are written this way.
