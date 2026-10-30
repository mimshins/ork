# RFC-001 — Integrations as adapters behind a registry

- **Status:** Implemented
- **Date:** 2026-10-30
- **Supersedes:** —
- **Superseded by:** —

## Context

Ork's author set a design rule: adding an integration (GitLab, GCP, a new Claude
driver) must not be hard; it should be an interface, adapters, and a registry.

The engine already works through ports: `ClaudeRuntime`, `NodeExecutors`,
`HumanChannel`, `Workspace`, `ToolRunner`. The integrations themselves do not.
Each one is spread over four places:

| Place                                                               | What is hard-coded                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [schema/src/nodes.ts](../../packages/schema/src/nodes.ts)           | `tool.gh`, `tool.aws`, `tool.shell` as three schemas in the node union; `DriverSchema` is `sdk \| cli` |
| [nodes/src/tools.ts](../../packages/nodes/src/tools.ts)             | `commandOf` branches per type for the program and AWS's `--profile`/`--region`                         |
| [cli/src/doctor/checks.ts](../../packages/cli/src/doctor/checks.ts) | the gh and aws login checks                                                                            |
| [cli/src/commands/run.ts](../../packages/cli/src/commands/run.ts)   | the `sdk`/`cli` choice in `loadRuntime`                                                                |

Adding GitLab (`glab`) or GCP (`gcloud`) today means editing all four, plus
`OUTPUT_FIELDS` in the compiler.

## Options

### Option A — One adapter file per integration, in a registry package

A new `@krapht/ork-integrations` package, below `schema`
(`integrations <- schema <- core …`), holds the `Integration` interface and one
file per integration:

```ts
export const gitlab = defineIntegration({
  id: "gitlab", // node type `tool.gitlab`
  program: "glab",
  options: z.strictObject({ host: z.string().optional() }), // extra node fields
  args: ({ host }) => (host === undefined ? [] : ["--hostname", host]),
  doctor: {
    version: ["--version"],
    auth: ["auth", "status"],
    login: "glab auth login",
  },
});
export const INTEGRATIONS = [gh, aws, gitlab, gcloud, shell] as const;
```

- `schema` builds the tool node schemas, the node union and the JSON Schema from
  `INTEGRATIONS`; `nodes` builds argv from `args`; `ork doctor` checks every
  integration from `doctor`; the compiler's report fields come from one place.
- Claude drivers get the same treatment in `runtime-claude`: a `DRIVERS`
  registry (`{ id, create, doctor }`), and `DriverSchema` from its ids.
- Adding GitLab is one file and one line in the registry.
- **Pros:** typed, autocomplete in editors, one file per integration, tests per
  adapter; no format change for existing workflows.
- **Cons:** a new package and a boundary change (ADR); adding an integration
  still means a release of Ork.

### Option B — Option A, plus integrations declared in the workflow

Option A, and a workflow (or `~/.ork/integrations.yaml`) may declare its own CLI
integration as data:

```yaml
integrations:
  gcloud:
    program: gcloud
    doctor:
      { auth: [auth, list, "--filter=status:ACTIVE"], login: gcloud auth login }
nodes:
  deploy:
    {
      type: tool.gcloud,
      command: "run deploy api --source .",
      allow: [run deploy],
    }
```

- **Pros:** users add a CLI without changing Ork; same runtime path as the
  built-ins.
- **Cons:** a workflow-format change; a declared integration has no typed extra
  options (only `command`, `allow`, `cwd`); a shared workflow can name programs
  that must exist on every machine (doctor reports them).

### Option C — A generic `tool` node only

Replace `tool.gh` / `tool.aws` with `type: tool, use: gh` and validate `use`
against the registry at compile time.

- **Pros:** the union never changes.
- **Cons:** breaks every existing workflow file (a `schemaVersion` bump and a
  migration), and loses typed per-integration fields in the JSON Schema.

## Decision

**Option A**, decided by the author on 2026-10-30: one typed adapter per
integration in `@krapht/ork-integrations`, and a registry for the Claude
drivers. The refactor moves `gh`, `aws` and `shell` (the mechanism only; new
adapters come when they are needed) and lands now, before delegation and the
context compiler. Option B stays open as a follow-up. Recorded in
[ADR-022](../../decisions/ADR-022-integration-registry.md).

## Consequences

- A new package `@krapht/ork-integrations` and an updated dependency direction
  (`integrations <- schema <- core <- runtime-claude, nodes <- server <- cli`);
  an ADR records it and `oxlint.config.ts` enforces it.
- The `gh`, `aws` and `shell` integrations move into adapters with tests; the
  Claude drivers move behind a `DRIVERS` registry.
- Specs to update: `workflow-format`, `scheduler` (tool nodes), `cli` (doctor),
  `runtime`, `architecture`; the interaction map's node types card.

## Open questions

None left: the mechanism only, and now.
