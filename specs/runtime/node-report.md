# The node report

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built**: the report schema
([runtime/report.ts](../../packages/core/src/runtime/report.ts)), structured
output on `claude-code`, and Ork's `report` tool
([report.ts](../../packages/runtime/src/tools/report.ts),
[tests](../../packages/runtime/test/report-tool.test.ts)) for a driver without
`reportSchema`. Why:
[ADR-010](../../decisions/ADR-010-reports-as-structured-output.md),
[RFC-014](../../rfcs/archived/RFC-014-cli-drivers-only.md).

A session node ends with a report, held to one JSON Schema:

- The JSON Schema has `status` (`pass`, `changes_requested`, `fail`, `done`),
  `summary`, `artifacts` (name → repository-relative path), `branch`, and one
  property per field of the node's `output.schema`. A list in `output.schema` is
  an enum, a primitive name (`string`, `number`, `integer`, `boolean`) is that
  type, and an object is taken as JSON Schema.
- `status`, `summary` and every `output.schema` field are required; no other
  field is allowed.
- A session without a valid report has `report: null`; the scheduler treats it
  as `fail`.

How the report reaches Ork depends on the driver's `reportSchema` capability
([drivers](../runtime.md#the-drivers)):

- **Structured output**, where the driver holds its final answer to the schema
  itself (`reportSchema: true`; `claude-code`'s `--json-schema`). The report is
  read from the tool's result line.
- **Ork's `report` tool**, where it can't (`reportSchema: false`; `open-code`
  and `command-code`). The session runner serves it on Ork's MCP endpoint only
  then, preapproved, with the node's report schema as its input schema. Zod
  checks each call against that schema (`z.fromJSONSchema`; Ork adds no other
  validator). A report that breaks it comes back as a tool error naming each
  violation (a wrong value, a missing field, a stray one), and the model fixes
  it and calls again. One that fits is kept. The session ends with the last
  report kept, across all its legs, whatever the tool's result line says; with
  none kept, it ends with `report: null`. A leader's question fork is held to
  its own schema the same way.
- The fake tools play both: `report-tool` in the contract suite calls the tool
  with a report outside the schema, then one inside
  ([contract](../../packages/runtime/test/contract/contract.test.ts)).

**Limit.** A schema Zod cannot read (a JSON Schema feature it does not support,
in an object field of `output.schema`) takes any object; the report must still
have a `status` and a `summary`. No node's schema needs more today.
