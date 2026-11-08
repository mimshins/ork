/**
 * @file Tests for the compiler's checks on `forEach` (RFC-013): its source,
 *   where `{{item}}` may be read, the gathered fields, channels, loops and git
 *   names.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

/** What compiling these nodes (and the rest of a workflow file) finds. */
const found = (body: string) => {
  const parsed = parseWorkflow(`schemaVersion: 1\nname: t\n${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow).diagnostics;
};

const codesOf = (body: string) =>
  found(body).map(d => `${d.severity}:${d.code}`);

/** The path of the one diagnostic with this code. */
const pathOf = (body: string, code: string) =>
  found(body).find(d => d.code === code)?.path;

const PLAN = `  plan:
    type: tool.shell
    command: plan
    output:
      format: json
      schema: { tasks: { list: { title: string } }, name: string }
`;

/** A planner and a fanned `build` after it, with this `forEach` and `prompt`. */
const fanned = (forEach: string, prompt = "Do it", extra = "") => `nodes:
${PLAN}  build:
    type: claude.worker
    forEach: ${forEach}
    prompt: "${prompt}"
${extra}edges:
  - plan -> build
`;

const FROM = '{ from: "{{nodes.plan.output.json.tasks}}", maxItems: 4 }';

/** A fanned node and one that reads this field of it. */
const reads = (field: string) => `nodes:
  build: { type: claude.worker, prompt: Go, forEach: { items: [a] } }
  after: { type: claude.worker, prompt: "{{nodes.build.output.${field}}}" }
edges:
  - build -> after
`;

/** A fanned node and an edge out of it with this condition. */
const edge = (when: string) => `nodes:
  build: { type: claude.worker, prompt: Go, forEach: { items: [a] } }
  after: { type: claude.worker, prompt: Go }
edges:
  - { from: build, to: after, when: "${when}" }
`;

/** A loop through a worker, which may be fanned. */
const loop = (each: string) => `nodes:
  build: { type: claude.worker, prompt: Go${each} }
  review: { type: claude.worker, prompt: Go }
edges:
  - build -> review
  - { from: review, to: build, when: "status == 'changes_requested'", maxRounds: 2 }
`;

/** A fanned worker under git rules with this worktree template. */
const rules = (template: string) => `rules:
  git: { worktrees: "${template}", branch: "ork/{run}" }
nodes:
  build: { type: claude.worker, prompt: Go, forEach: { items: [a, b] } }
`;

/** The errors about git names. */
const ruleErrors = (body: string) =>
  found(body).filter(
    d => d.code === "rules.template" && d.severity === "error",
  );

/** What loop.uncapped says of a loop through a worker with this `forEach`. */
const sessions = (each: string): string | undefined =>
  found(loop(each)).find(d => d.code === "loop.uncapped")?.message;

describe("forEach's source", () => {
  it("accepts a declared list", () => {
    expect(codesOf(fanned(FROM, "{{item.title}} {{index}}"))).toEqual([]);
  });

  it("accepts a static list", () => {
    expect(codesOf(fanned("{ items: [a, b] }", "{{item}}"))).toEqual([]);
  });

  it.each([
    "{{nodes.plan.output.json.tasks}} and more",
    "{{nodes.plan.output.json.tasks}}{{nodes.plan.output.json.name}}",
    "no path at all",
    "{{ 1 + 2 }}",
  ])("needs exactly one path, not %s", from => {
    const body = fanned(`{ from: "${from}", maxItems: 4 }`);
    expect(codesOf(body)).toContain("error:forEach.from-path");
    expect(pathOf(body, "forEach.from-path")).toEqual([
      "nodes",
      "build",
      "forEach",
      "from",
    ]);
  });

  it("refuses a field the source declares as something else", () => {
    const body = fanned(
      '{ from: "{{nodes.plan.output.json.name}}", maxItems: 4 }',
    );
    expect(codesOf(body)).toEqual(["error:forEach.not-list"]);
    expect(pathOf(body, "forEach.not-list")).toEqual([
      "nodes",
      "build",
      "forEach",
      "from",
    ]);
  });

  it("refuses a workflow input, which is text", () => {
    const body = `inputs:\n  q: { type: string }\n${fanned(
      '{ from: "{{inputs.q}}", maxItems: 4 }',
    )}`;
    expect(codesOf(body)).toEqual(["error:forEach.not-list"]);
  });

  it("refuses a source that can't have run before it", () => {
    const body = `nodes:
${PLAN}  build:
    type: claude.worker
    forEach: ${FROM}
    prompt: Do it
`;
    expect(codesOf(body)).toContain("error:forEach.order");
    expect(pathOf(body, "forEach.order")).toEqual([
      "nodes",
      "build",
      "forEach",
      "from",
    ]);
  });

  it("warns about a source that declares no list", () => {
    const body = fanned(
      '{ from: "{{nodes.plan.output.json.other}}", maxItems: 4 }',
    );
    expect(codesOf(body)).toEqual(["warning:forEach.undeclared"]);
    expect(pathOf(body, "forEach.undeclared")).toEqual([
      "nodes",
      "build",
      "forEach",
      "from",
    ]);
  });

  it("reads an unknown node as a reference error", () => {
    expect(
      codesOf(fanned('{ from: "{{nodes.nope.output.tasks}}", maxItems: 4 }')),
    ).toContain("error:ref.node");
  });

  it("takes a fanned node's gathered list as a source", () => {
    const body = `nodes:
  a: { type: tool.shell, command: x, forEach: { items: [1, 2] } }
  b:
    type: claude.worker
    prompt: Go
    forEach: { from: "{{nodes.a.output.results}}", maxItems: 3 }
edges:
  - a -> b
`;
    expect(codesOf(body)).toEqual([]);
  });
});

describe("{{item}} and {{index}}", () => {
  it("are refused in a node with no forEach", () => {
    const body = `nodes:
  a: { type: claude.worker, prompt: "{{item}} {{index}}" }
`;
    expect(codesOf(body)).toEqual(["error:item.outside", "error:item.outside"]);
    expect(pathOf(body, "item.outside")).toEqual(["nodes", "a", "prompt"]);
  });

  it.each([
    ["instructions", 'instructions: "{{item}}"'],
    ["context", 'context: ["{{item}}.md"]'],
    ["skills", 'skills: ["{{index}}"]'],
  ])("are refused in a fanned node's %s", (field, line) => {
    const body = fanned("{ items: [a] }", "Go", `    ${line}\n`);
    expect(codesOf(body)).toEqual(["error:item.outside"]);
    expect(pathOf(body, "item.outside")?.slice(0, 3)).toEqual([
      "nodes",
      "build",
      field,
    ]);
  });

  it("are refused in a fanned node's before:, verify: and notify body", () => {
    const body = `nodes:
  a:
    type: claude.worker
    prompt: Go
    forEach: { items: [a] }
    before: { command: "echo {{item}}" }
    notify: [{ to: b, body: "{{item}}" }]
  b: { type: claude.worker, prompt: x }
edges:
  - a -> b
`;
    expect(codesOf(body)).toEqual(["error:item.outside", "error:item.outside"]);
  });

  it("are read in each template of a fanned node", () => {
    const body = `nodes:
  tool:
    type: tool.shell
    command: "run {{item}} {{index}}"
    env: { WHO: "{{item}}" }
    forEach: { items: [a] }
  mcp:
    type: mcp.call
    server: s
    tool: t
    arguments: { x: "{{item}}" }
    env: { WHO: "{{item}}" }
    forEach: { items: [a] }
  call:
    type: workflow.call
    workflow: w
    inputs: { x: "{{item}}" }
    ref: "{{item}}"
    forEach: { items: [a] }
  cwd:
    type: tool.shell
    command: x
    cwd: "{{item}}"
    forEach: { items: [a] }
`;
    expect(found(body).filter(d => d.code.startsWith("item."))).toEqual([
      expect.objectContaining({
        code: "item.outside",
        path: ["nodes", "cwd", "cwd"],
      }),
    ]);
  });

  it("are not roots of a condition, where item is a field of output", () => {
    const body = `nodes:
  a: { type: claude.worker, prompt: Go, output: { schema: { item: [x, y] } } }
  b: { type: claude.worker, prompt: Go }
edges:
  - { from: a, to: b, when: "item == 'x'" }
`;
    expect(codesOf(body)).toEqual([]);
  });

  it("name only fields an item has: a declared shape", () => {
    const ok = fanned(FROM, "{{item.title}}");
    const bad = fanned(FROM, "{{item.title}} {{item.nope}}");
    expect(codesOf(ok)).toEqual([]);
    expect(codesOf(bad)).toEqual(["error:item.field"]);
    expect(pathOf(bad, "item.field")).toEqual(["nodes", "build", "prompt"]);
  });

  it("name only fields every static entry has", () => {
    const entries = "{ items: [{ a: 1, b: 2 }, { a: 3 }] }";
    expect(codesOf(fanned(entries, "{{item.a}}"))).toEqual([]);
    expect(codesOf(fanned(entries, "{{item.b}}"))).toEqual([
      "error:item.field",
    ]);
    expect(codesOf(fanned("{ items: [x, y] }", "{{item.a}}"))).toEqual([
      "error:item.field",
    ]);
  });

  it("are not checked for fields when the source declares no shape", () => {
    const body = `nodes:
  plan:
    type: tool.shell
    command: plan
    output: { format: json, schema: { tasks: { list: {} } } }
  build:
    type: claude.worker
    prompt: "{{item.anything}}"
    forEach: ${FROM}
edges:
  - plan -> build
`;
    expect(codesOf(body)).toEqual([]);
  });
});

describe("a fanned node's gathered fields", () => {
  it.each(["items", "results", "statuses", "count"])("reads %s", field => {
    expect(codesOf(reads(field))).toEqual([]);
  });

  it("refuses its type's own fields", () => {
    const body = reads("summary");
    expect(codesOf(body)).toEqual(["error:ref.field"]);
    expect(pathOf(body, "ref.field")).toEqual(["nodes", "after", "prompt"]);
  });

  it("refuses them in an edge condition, and reads statuses there", () => {
    expect(codesOf(edge("count(statuses, 'fail') > 0"))).toEqual([]);
    expect(codesOf(edge("summary == 'x'"))).toEqual(["error:ref.field"]);
  });

  it("doesn't take a tool's json for a missing format", () => {
    const body = `nodes:
  build: { type: tool.shell, command: x, forEach: { items: [a] } }
  after: { type: claude.worker, prompt: "{{nodes.build.output.json.x}}" }
edges:
  - build -> after
`;
    expect(found(body).map(d => d.code)).toEqual(["ref.field"]);
  });
});

describe("a messages channel", () => {
  it("refuses a fanned node", () => {
    const body = `nodes:
  lead: { type: claude.leader, prompt: Go }
  build: { type: claude.worker, prompt: Go, forEach: { items: [a] } }
edges:
  - lead -> build
messages:
  - { between: [lead, build] }
`;
    expect(codesOf(body)).toContain("error:forEach.channel");
    expect(pathOf(body, "forEach.channel")).toEqual(["messages", 0, "between"]);
  });
});

describe("loop.uncapped", () => {
  it("counts one session for each node without forEach", () => {
    expect(sessions("")).toContain("about 6 sessions");
  });

  it("multiplies by a static list's length", () => {
    expect(sessions(", forEach: { items: [a, b, c] }")).toContain(
      "about 12 sessions",
    );
  });

  it("multiplies by maxItems", () => {
    expect(
      sessions(', forEach: { from: "{{inputs.x}}", maxItems: 5 }'),
    ).toContain("about 18 sessions");
  });
});

describe("git names", () => {
  it("needs {node} for a fanned worktree node, which has one per item", () => {
    expect(codesOf(rules("../wt-{run}"))).toContain("error:rules.template");
  });

  it("is satisfied per name by {node}", () => {
    expect(ruleErrors(rules("../wt-{run}-{node}"))).toEqual([
      expect.objectContaining({ path: ["rules", "git", "branch"] }),
    ]);
  });
});

const owned = (isolation: string, edges: string) => `nodes:
  lead: { type: claude.leader, prompt: l, isolation: ${isolation} }
  build:
    type: claude.worker
    parent: lead
    prompt: Go
    forEach: { items: [a, b] }
${edges}`;

const continued = (limit: string) => `nodes:
  plan: { type: claude.worker, prompt: p }
  build:
    type: claude.worker
    prompt: Go
    isolation: continue
    forEach: { items: [a, b]${limit} }
edges:
  - plan -> build
`;

describe("where a fanned node sits", () => {
  it("refuses items that would share one worktree at once", () => {
    expect(codesOf(continued(""))).toContain("error:forEach.continue");
    expect(codesOf(continued(", maxParallel: 1"))).not.toContain(
      "error:forEach.continue",
    );
  });

  it("refuses a fanned child nothing can run", () => {
    expect(codesOf(owned("worktree", ""))).toContain("error:forEach.unreached");
  });

  it("refuses items whose owner only starts after them", () => {
    const body = owned(
      "worktree",
      "  plan: { type: claude.worker, prompt: p }\nedges:\n  - plan -> build\n  - build -> lead\n",
    );
    expect(codesOf(body)).toContain("error:forEach.owner-order");
  });

  it("takes an owner that runs first, or has no worktree to merge into", () => {
    const first = "edges:\n  - lead -> build\n";
    expect(codesOf(owned("worktree", first))).not.toContain(
      "error:forEach.owner-order",
    );
    const none = owned(
      "readonly",
      "  plan: { type: claude.worker, prompt: p }\nedges:\n  - plan -> build\n",
    );
    expect(codesOf(none)).not.toContain("error:forEach.owner-order");
  });
});

const watched = (until: string) => `nodes:
  build:
    type: tool.shell
    command: x
    forEach: { items: [a, b] }
    watch: { every: 30s, until: "${until}", timeout: 1h }
`;

const fromAfter = (edges: string) => `nodes:
  setup: { type: claude.worker, prompt: s }
  lead:
    type: tool.shell
    command: x
    output: { format: json, schema: { tasks: { list: {} } } }
  build:
    type: claude.worker
    prompt: Go
    forEach: { from: "{{nodes.lead.output.json.tasks}}", maxItems: 4 }
${edges}`;

describe("a fanned node's other checks", () => {
  it("waits on what an item says, not on what it gathers", () => {
    expect(codesOf(watched("exitCode == 0"))).toEqual([]);
    expect(codesOf(watched("count > 0")).join()).toContain("ref.");
  });

  it("needs a from source that ran before its first activation", () => {
    const looped =
      "edges:\n  - setup -> build\n  - build -> lead\n  - { from: lead, to: build, maxRounds: 2 }\n";
    expect(codesOf(fromAfter(looped))).toContain("error:forEach.order");
    const first = "edges:\n  - lead -> build\n  - setup -> lead\n";
    expect(codesOf(fromAfter(first))).not.toContain("error:forEach.order");
  });

  it("refuses {{item}} in the workflow's outputs", () => {
    const body = `nodes:
  build: { type: claude.worker, prompt: Go, forEach: { items: [a] } }
outputs:
  one: "{{item}}"
`;
    expect(codesOf(body)).toContain("error:item.outside");
  });

  it("refuses a notify rule to a fanned node", () => {
    const body = `nodes:
  first:
    type: claude.worker
    prompt: Go
    notify: [{ to: build, body: done }]
  build: { type: claude.worker, prompt: Go, forEach: { items: [a] } }
edges:
  - first -> build
`;
    expect(codesOf(body)).toContain("error:forEach.notify");
  });
});
