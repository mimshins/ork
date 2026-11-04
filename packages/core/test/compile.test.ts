/** @file Tests for the graph compiler's checks and diagnostics. */

import { readFileSync } from "node:fs";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const load = (text: string) => {
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.workflow;
};

const compile = (text: string) => compileWorkflow(load(text));

const codes = (text: string) =>
  compile(text).diagnostics.map(d => `${d.severity}:${d.code}`);

const workflow = (body: string) =>
  `schemaVersion: 1\nname: t\ninputs:\n  feature:\n    type: string\n${body}`;

/** The codes of what compiling this workflow finds. */
const codesOf = (text: string) =>
  compile(workflow(text)).diagnostics.map(d => d.code);

/** A tool node with this `env:`. */
const envOf = (env: string) => `nodes:
  a:
    type: tool.shell
    command: prog
    env: ${env}
`;

const plain = (reads: string, name: string) =>
  codesOf(`nodes:
  a:
    type: tool.shell
    command: prog
    env: { R: "{{env.${reads}}}" }
    plainEnv: [${name}]
`);

const scriptCodes = (fields: string): string[] => {
  const parsed = parseWorkflow(
    `schemaVersion: 1\nname: t\nnodes:\n  a: { type: tool.shell, ${fields} }\n`,
  );
  return parsed.ok
    ? compileWorkflow(parsed.workflow).diagnostics.map(d => d.code)
    : parsed.diagnostics.map(d => d.code);
};

describe("a tool node's script", () => {
  it.each([
    ["a command", "command: prog"],
    ["a script", "script: 'echo hi'"],
    ["a script and its interpreter", "script: 'x', interpreter: python3"],
  ])("takes %s", (_name, fields) => {
    expect(scriptCodes(fields)).toEqual([]);
  });

  it.each([
    ["neither", "cwd: x", "tool.command"],
    ["both", "command: prog, script: 'echo hi'", "tool.command"],
    ["an empty script", "script: '  '", "tool.command"],
    ["a template", "script: 'echo {{inputs.x}}'", "script.template"],
    [
      "an interpreter alone",
      "command: x, interpreter: sh",
      "script.interpreter",
    ],
    [
      "a template in the interpreter",
      "script: x, interpreter: '{{inputs.x}}'",
      "script.interpreter",
    ],
  ])("refuses %s", (_name, fields, code) => {
    expect(scriptCodes(fields)).toContain(code);
  });

  it("is only for a program-less tool", () => {
    const parsed = parseWorkflow(
      "schemaVersion: 1\nname: t\nnodes:\n  a: { type: tool.gh, command: x, script: y }\n",
    );
    expect(parsed.ok).toBe(false);
  });
});

const parsedOrThrow = (source: string) => {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const verifyCodesOf = (source: string): string[] => {
  const parsed = parseWorkflow(source);
  return parsed.ok
    ? compileWorkflow(parsed.workflow).diagnostics.map(d => d.code)
    : ["did not parse"];
};

const verifyDiagnostics = (verify: string, more = "") => {
  const parsed = parseWorkflow(
    `schemaVersion: 1\nname: t\nnodes:\n  w: { type: claude.worker, verify: ${verify}${more} }\n`,
  );
  return parsed.ok ? compileWorkflow(parsed.workflow).diagnostics : [];
};

describe("verify:", () => {
  it("takes a command or a script, with env: reading the user's variables", () => {
    expect(verifyDiagnostics("{ command: pnpm test }")).toEqual([]);
    expect(
      verifyDiagnostics(
        "{ script: 'pnpm test', env: { T: '{{env.PROBE}}' }, attempts: 2 }",
      ),
    ).toEqual([]);
  });

  it.each([
    ["no program", "{ attempts: 2 }", "tool.command", ["nodes", "w", "verify"]],
    [
      "a template in a script",
      "{ script: 'x {{inputs.a}}' }",
      "script.template",
      ["nodes", "w", "verify", "script"],
    ],
    [
      "a reserved name",
      "{ command: x, env: { ORK_RUN: y } }",
      "env.reserved",
      ["nodes", "w", "verify", "env", "ORK_RUN"],
    ],
    [
      "the user's variable in its command",
      "{ command: 'x {{env.HOME}}' }",
      "template.env",
      ["nodes", "w", "verify", "command"],
    ],
    [
      "an unknown input",
      "{ command: 'x {{inputs.nope}}' }",
      "ref.input",
      ["nodes", "w", "verify", "command"],
    ],
  ])("refuses %s, and says where", (_name, verify, code, where) => {
    expect(verifyDiagnostics(verify).find(d => d.code === code)?.path).toEqual(
      where,
    );
  });

  it("keeps the name output.verify for itself", () => {
    expect(
      verifyDiagnostics(
        "{ command: x }",
        ", output: { schema: { verify: { type: string } } }",
      ).map(d => d.code),
    ).toContain("verify.field");
  });

  it("is read as an output field of the node", () => {
    expect(
      verifyCodesOf(
        `schemaVersion: 1\nname: t\nnodes:\n  w: { type: claude.worker, verify: { command: x } }\n  n: { type: tool.shell, command: "y {{nodes.w.output.verify.exitCode}}" }\nedges:\n  - w -> n\n`,
      ),
    ).toEqual([]);
  });

  it("is only for leaders and workers", () => {
    const parsed = parseWorkflow(
      "schemaVersion: 1\nname: t\nnodes:\n  l: { type: claude.leader }\n  s: { type: claude.subagent, parent: l, verify: { command: x } }\n",
    );
    expect(parsed.ok).toBe(false);
  });
});

const beforeOf = (fields: string, defaults = "") =>
  compileWorkflow(
    parsedOrThrow(
      `schemaVersion: 1\nname: t\n${defaults}nodes:\n  w: { type: claude.worker, ${fields} }\n`,
    ),
  ).diagnostics;

describe("before:", () => {
  it("lets its node's prompt read it", () => {
    expect(
      beforeOf(
        "prompt: '{{before.stdout}} {{before.exitCode}}', before: { command: x }",
      ),
    ).toEqual([]);
    expect(
      beforeOf(
        "prompt: '{{before.json.id}}', before: { command: x, output: { format: json } }",
      ),
    ).toEqual([]);
  });

  it("takes one from the defaults", () => {
    expect(
      beforeOf(
        "prompt: '{{before.stdout}}'",
        "defaults:\n  before: { command: x }\n",
      ),
    ).toEqual([]);
  });

  it.each([
    ["with no before:", "prompt: '{{before.stdout}}'", "template.scope"],
    [
      "outside a prompt",
      "instructions: '{{before.stdout}}', before: { command: x }",
      "template.scope",
    ],
    [
      "a field it does not report",
      "prompt: '{{before.nope}}', before: { command: x }",
      "ref.before",
    ],
    [
      "JSON it does not return",
      "prompt: '{{before.json.x}}', before: { command: x }",
      "ref.before",
    ],
  ])("refuses a read %s", (_name, fields, code) => {
    expect(beforeOf(fields).map(d => d.code)).toContain(code);
  });

  it("checks a default where it is, and refuses a node's output there", () => {
    const [found] = beforeOf(
      "prompt: hi",
      "defaults:\n  before: { command: 'x {{nodes.w.output.summary}}' }\n",
    );
    expect(found?.code).toBe("template.scope");
    expect(found?.path).toEqual(["defaults", "before", "command"]);
    expect(
      beforeOf(
        "prompt: hi",
        "defaults:\n  before: { script: 'x {{inputs.a}}' }\n",
      ).find(d => d.code === "script.template")?.path,
    ).toEqual(["defaults", "before", "script"]);
  });

  it("refuses a bare before where it would read as nothing", () => {
    const { diagnostics } = compile(`schemaVersion: 1
name: t
nodes:
  w: { type: claude.worker, prompt: hi, before: { command: x } }
  n: { type: claude.worker, prompt: hi }
edges:
  - { from: w, to: n, when: "before.exitCode != 0" }
`);
    expect(diagnostics.map(d => d.code)).toContain("ref.before");
  });

  it("refuses a blank script beside a command, which would run instead", () => {
    expect(
      beforeOf("prompt: hi, before: { command: 'false', script: '' }").map(
        d => d.code,
      ),
    ).toContain("tool.command");
  });

  it("warns of an output field called before", () => {
    expect(
      beforeOf(
        "prompt: hi, output: { schema: { before: { type: string } } }",
      ).map(d => [d.severity, d.code]),
    ).toContainEqual(["warning", "before.field"]);
  });
});

const mcpDiagnostics = (fields: string, more = "") =>
  compileWorkflow(
    parsedOrThrow(
      `schemaVersion: 1\nname: t\ninputs:\n  a: { type: string }\nnodes:\n  m: { type: mcp.call, server: s, tool: t, ${fields} }\n${more}`,
    ),
  ).diagnostics;

describe("mcp.call", () => {
  it("takes templates in its arguments, and env: reads the user's variables", () => {
    expect(
      mcpDiagnostics(
        "arguments: { id: '{{inputs.a}}', deep: { x: ['{{run.id}}'] } }, env: { T: '{{env.PROBE}}' }",
      ),
    ).toEqual([]);
  });

  it("says where a bad reference in its arguments is", () => {
    const found = mcpDiagnostics(
      "arguments: { deep: { x: '{{inputs.nope}}' } }",
    ).find(d => d.code === "ref.input");
    expect(found?.path).toEqual(["nodes", "m", "arguments", "deep", "x"]);
  });

  it("keeps the user's variables out of what it records", () => {
    expect(
      mcpDiagnostics("arguments: { id: '{{env.PROBE}}' }").map(d => d.code),
    ).toContain("template.env");
  });

  it("reports text and json", () => {
    expect(
      mcpDiagnostics(
        "output: { schema: { a: string } }",
        "  n: { type: tool.shell, command: 'x {{nodes.m.output.json.a}} {{nodes.m.output.text}}' }\nedges:\n  - m -> n\n",
      ),
    ).toEqual([]);
    expect(
      mcpDiagnostics(
        "arguments: {}",
        "  n: { type: tool.shell, command: 'x {{nodes.m.output.nope}}' }\nedges:\n  - m -> n\n",
      ).map(d => d.code),
    ).toContain("ref.field");
  });

  it("needs a server and a tool", () => {
    const parsed = parseWorkflow(
      "schemaVersion: 1\nname: t\nnodes:\n  m: { type: mcp.call, server: s }\n",
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("compileWorkflow", () => {
  it("compiles the software-factory example with no diagnostics", () => {
    const example = readFileSync(
      new URL("../../../examples/software-factory.ork.yaml", import.meta.url),
      "utf8",
    );
    const result = compile(example);
    expect(result.diagnostics).toEqual([]);
    expect(result.graph?.entries).toEqual(["spec"]);
    expect(result.graph?.nodes.get("builder")?.children).toEqual([
      "security",
      "ux",
      "code",
    ]);
    expect(result.graph?.edges).toHaveLength(14);
  });

  it("rejects a cycle with no maxRounds", () => {
    const result = compile(
      workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
  c: { type: control.split }
edges:
  - a -> b
  - b -> c
  - c -> b
`),
    );
    expect(result.graph).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({
      code: "graph.unbounded-cycle",
      path: ["edges", 1],
    });
  });

  it("accepts the same cycle when one edge is bounded", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
  c: { type: control.split }
edges:
  - a -> b
  - b -> c
  - { from: c, to: b, maxRounds: 3 }
`),
      ),
    ).toEqual([]);
  });

  it("checks the ownership tree", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader }
  w: { type: claude.worker, parent: lead }
  s: { type: claude.subagent, parent: w, description: helper }
  bad: { type: tool.shell, command: ls, parent: w }
  lost: { type: claude.worker, parent: ghost }
  x: { type: claude.leader, parent: y }
  y: { type: claude.leader, parent: x }
`),
      ),
    ).toEqual([
      "error:tree.owner-kind",
      "error:tree.unknown-parent",
      "error:tree.cycle",
      "warning:graph.unreachable",
      "warning:graph.unreachable",
      "warning:graph.unreachable",
    ]);
  });

  it("keeps a continue node out of the ownership tree", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader, isolation: continue }
  w: { type: claude.worker, parent: lead, isolation: continue }
  next: { type: claude.worker, isolation: continue }
edges:
  - lead -> next
`),
      ),
    ).toEqual(["error:tree.continue", "error:tree.continue"]);
  });

  it("checks edges", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader }
  sub: { type: claude.subagent, parent: lead, description: helper }
  end: { type: control.split }
edges:
  - lead -> nowhere
  - lead -> sub
  - lead -> end -> lead
  - { from: lead, to: end, when: "status ==" }
  - { from: lead, to: end, maxRounds: 2 }
`),
      ),
    ).toEqual([
      "error:edge.unknown-node",
      "error:edge.subagent",
      "error:edge.syntax",
      "error:edge.when-syntax",
      "warning:edge.max-rounds-unused",
    ]);
  });

  it("checks references in templates and conditions", () => {
    const diagnostics = compile(
      workflow(`nodes:
  a:
    type: claude.worker
    prompt: "{{inputs.feature}} {{inputs.missing}} {{nodes.b.output.summary}}"
  b:
    type: claude.worker
    prompt: "{{nodes.a.output.summary}} {{nodes.a.output.nope}} {{nodes.ghost.output.x}} {{nodes.a.summary}} {{verdict}}"
    output: { schema: { verdict: [yes, no] } }
  c: { type: control.split }
edges:
  - a -> b
  - { from: b, to: c, when: "verdict == 'yes' && colour == 'red'" }
`),
    ).diagnostics;
    expect(diagnostics.map(d => `${d.code} ${d.path.join(".")}`)).toEqual([
      "ref.input nodes.a.prompt",
      "ref.node nodes.b.prompt",
      "ref.node nodes.b.prompt",
      "template.scope nodes.b.prompt",
      "template.not-upstream nodes.a.prompt",
      "ref.field nodes.b.prompt",
      "ref.field edges.1.when",
    ]);
  });

  it("knows the fields an integration observes, such as git's staged changes", () => {
    const diagnostics = compile(
      workflow(`nodes:
  stage: { type: tool.git, command: add -A }
  gate:
    type: human.gate
    question: "{{nodes.stage.output.staged}} {{nodes.stage.output.head}} {{nodes.stage.output.nope}}"
    options: [commit, stop]
edges:
  - stage -> gate
`),
    ).diagnostics;
    expect(diagnostics.map(d => `${d.code} ${d.message}`)).toEqual([
      'ref.field "nodes.stage.output.nope": a tool.git reports exitCode, stdout, stderr, staged, diff, head',
    ]);
  });

  it("reads a tool node's JSON only when it says it has some", () => {
    expect(
      codesOf(`nodes:
  pr: { type: tool.gh, command: pr view, output: { format: json } }
  next: { type: tool.shell, command: "echo {{nodes.pr.output.json.state}}" }
edges:
  - { from: pr, to: next, when: "json.state == 'OPEN'" }
`),
    ).toEqual(["ref.undeclared", "ref.undeclared"]);
    expect(
      codesOf(`nodes:
  pr: { type: tool.gh, command: pr view, output: { format: json, schema: { state: [OPEN, CLOSED] } } }
  next: { type: tool.shell, command: "echo {{nodes.pr.output.json.state}}" }
edges:
  - { from: pr, to: next, when: "json.state == 'OPEN'" }
`),
    ).toEqual([]);
    expect(
      codesOf(`nodes:
  pr: { type: tool.gh, command: pr view }
  next: { type: tool.shell, command: "echo {{nodes.pr.output.json.state}}" }
edges:
  - { from: pr, to: next, when: "json.state == 'OPEN'" }
`),
    ).toEqual(["ref.json", "ref.json"]);
  });

  it("keeps the user's variables to a tool node's env", () => {
    expect(
      codesOf(`nodes:
  a:
    type: tool.shell
    command: prog
    env: { GH_TOKEN: "{{env.MY_TOKEN}}" }
`),
    ).toEqual([]);
    expect(
      codesOf(`nodes:
  a: { type: tool.shell, command: "prog {{env.MY_TOKEN}}" }
`),
    ).toEqual(["template.env"]);
    expect(
      codesOf(`nodes:
  a: { type: tool.shell, command: prog }
outputs:
  leak: "{{env.MY_TOKEN}}"
`),
    ).toEqual(["template.env"]);
  });

  it("checks a tool node's env names and values", () => {
    expect(codesOf(envOf(`{ ORK_RUN: x }`))).toEqual(["env.reserved"]);
    expect(codesOf(envOf(`{ API_KEY: abc123 }`))).toEqual(["env.literal"]);
    expect(codesOf(envOf(`{ PATH: "{{run.id}}" }`))).toEqual([]);
    expect(codesOf(envOf(`{ HOST: example.com }`))).toEqual([]);
  });

  it.each([
    "API_KEY",
    "GH_TOKEN",
    "apiToken",
    "DB_PASSWORD",
    "CLIENT_SECRET",
    "GHTOKEN",
    "NPMTOKEN",
    "PGPASSWORD",
    "SECRETKEY",
    "API_TOKENS",
    "DB_PASS",
    "PASSPHRASE",
  ])("points out a literal under %s", name => {
    expect(codesOf(envOf(`{ ${name}: abc123 }`))).toEqual(["env.literal"]);
  });

  it.each([
    "MAX_TOKENS",
    "TOKENIZERS_PARALLELISM",
    "KEYBOARD",
    "SSH_KEY_PATH",
    "MONKEY",
  ])("leaves a literal under %s alone", name => {
    expect(codesOf(envOf(`{ ${name}: "4000" }`))).toEqual([]);
  });

  it("points out a URL with a password in it", () => {
    expect(
      codesOf(envOf(`{ DATABASE_URL: "postgres://me:hunter2@db/x" }`)),
    ).toEqual(["env.literal"]);
    expect(codesOf(envOf(`{ DATABASE_URL: "postgres://db/x" }`))).toEqual([]);
    expect(codesOf(envOf(`{ REDIS_URL: "redis://:hunter2@h/0" }`))).toEqual([
      "env.literal",
    ]);
    expect(
      codesOf(envOf(`{ DB: "postgres://me:hunter2@{{inputs.host}}/db" }`)),
    ).toContain("env.literal");
    expect(codesOf(envOf(`{ DB: "postgres://me:{{env.P}}@h/db" }`))).toEqual(
      [],
    );
  });

  it.each(["BASH_ENV", "ENV", "GIT_SSH_COMMAND", "PYTHONSTARTUP"])(
    "warns when a run's data sets %s",
    name => {
      const { diagnostics } = compile(
        workflow(`nodes:
  b: { type: tool.shell, command: prog }
  a:
    type: tool.shell
    command: prog
    env: { ${name}: "{{nodes.b.output.stdout}}" }
edges:
  - b -> a
`),
      );
      expect(diagnostics.map(d => d.code)).toEqual(["env.code"]);
    },
  );

  it("checks what plainEnv names", () => {
    expect(plain("REGION", "REGION")).toEqual([]);
    expect(plain("REGION", "OTHER")).toEqual(["env.plain"]);
    expect(plain("MY_TOKEN", "MY_TOKEN")).toEqual(["env.plain"]);
  });

  it("refuses the user's variables in an edge's when", () => {
    expect(
      codesOf(`nodes:
  a: { type: tool.shell, command: prog }
  b: { type: tool.shell, command: prog }
edges:
  - { from: a, to: b, when: "env.X == 'y'" }
`),
    ).toEqual(["template.env"]);
  });

  it("warns when a run's data sets a name that changes which code runs", () => {
    const { diagnostics } = compile(
      workflow(`nodes:
  b: { type: tool.shell, command: prog }
  a:
    type: tool.shell
    command: prog
    env: { NODE_OPTIONS: "{{nodes.b.output.stdout}}" }
edges:
  - b -> a
`),
    );
    expect(diagnostics.map(d => d.code)).toEqual(["env.code"]);
  });

  it("checks joins, gates and channels", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: claude.leader }
  b: { type: claude.worker, parent: a }
  t: { type: tool.gh, command: pr list }
  j: { type: control.join, mode: n, n: 3 }
  g:
    type: human.gate
    question: ok?
    options: [yes, no]
    recommended: maybe
    timeout: 5m
edges:
  - a -> j
  - j -> g
messages:
  - between: [a, b]
  - between: [a, g]
`),
      ),
    ).toEqual([
      "error:join.n",
      "error:gate.option",
      "error:gate.timeout",
      "error:message.endpoint",
      "warning:join.inputs",
      "warning:message.implicit",
    ]);
  });

  it("requires an entry node", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
edges:
  - a -> b
  - b -> a
`),
      ),
    ).toContain("error:graph.no-entry");
  });

  it("warns that a sub-agent's timeout has no effect", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader, prompt: go }
  helper:
    type: claude.subagent
    parent: lead
    description: helps
    timeout: 5m
`),
      ),
    ).toContain("warning:timeout.subagent");
  });

  it("lets a first node loop back to itself", () => {
    const { graph, diagnostics } = compile(
      workflow(`nodes:
  flaky: { type: tool.shell, command: "true" }
  done: { type: tool.shell, command: "true" }
edges:
  - { from: flaky, to: flaky, when: "exitCode != 0", maxRounds: 2 }
  - { from: flaky, to: done, when: "exitCode == 0" }
`),
    );
    expect(diagnostics).toEqual([]);
    expect(graph?.entries).toEqual(["flaky"]);
  });

  it("does not start a node that has a forward edge and a loop edge", () => {
    const { graph } = compile(
      workflow(`nodes:
  a: { type: control.split }
  b: { type: control.split }
edges:
  - a -> b
  - { from: b, to: a, maxRounds: 1 }
`),
    );
    expect(graph?.entries).toEqual(["a"]);
  });

  it("refuses a call with an owner, or waiting on no node, or calling itself", () => {
    expect(
      codes(
        workflow(`nodes:
  lead: { type: claude.leader, prompt: l }
  kit: { type: workflow.call, workflow: other, parent: lead }
`),
      ),
    ).toContain("error:call.parent");
    expect(
      codes(
        workflow(`nodes:
  kit: { type: workflow.call, workflow: other, wait: node }
`),
      ),
    ).toEqual(["error:call.wait-node"]);
    expect(
      codes(
        workflow(`nodes:
  kit: { type: workflow.call, workflow: t }
`),
      ),
    ).toEqual(["error:call.self"]);
  });

  it("lets a call to the same name in another project through", () => {
    expect(
      codes(
        workflow(`nodes:
  kit: { type: workflow.call, workflow: t, project: other }
`),
      ),
    ).toEqual([]);
  });

  it("allows a channel to a call that names a node, unless links are off", () => {
    const channel = `nodes:
  builder: { type: claude.worker, prompt: b }
  kit: { type: workflow.call, workflow: other, node: builder }
messages:
  - between: [builder, kit]
`;
    expect(codes(workflow(channel))).toEqual([]);
    expect(codes(workflow(`rules:\n  links: off\n${channel}`))).toEqual([
      "error:call.links-off",
    ]);
  });

  it("refuses a channel between two calls, which has no session on it", () => {
    expect(
      codes(
        workflow(`nodes:
  a: { type: workflow.call, workflow: other, node: x }
  b: { type: workflow.call, workflow: other, node: y }
messages:
  - between: [a, b]
`),
      ),
    ).toEqual(["error:message.endpoint"]);
  });

  it("refuses a channel to a call that names no node", () => {
    expect(
      compile(
        workflow(`nodes:
  builder: { type: claude.worker, prompt: b }
  kit: { type: workflow.call, workflow: other }
messages:
  - between: [builder, kit]
`),
      ).graph,
    ).toBeNull();
  });

  it("checks a workflow's outputs like any other template", () => {
    expect(
      codes(
        workflow(`outputs:
  summary: "{{nodes.ghost.output.summary}}"
nodes:
  a: { type: tool.shell, command: "true" }
`),
      ),
    ).toEqual(["error:ref.node"]);
  });
});
