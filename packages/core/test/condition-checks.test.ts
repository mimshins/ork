/**
 * @file The checks on what conditions compare and on the shape of loops
 *   (RFC-009), each against a workflow that compiles clean without them.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { compileWorkflow } from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const examples = path.join(repoRoot, "examples");

const NEW_CODES = /^(when\.value|when\.never|loop\.)/u;

/** Compiles a workflow and gives only what these checks say of it. */
const found = (text: string) => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow).diagnostics.filter(({ code }) =>
    NEW_CODES.test(code),
  );
};

const codesOf = (body: string) =>
  found(`schemaVersion: 1\nname: t\n${body}`).map(
    ({ severity, code }) => `${severity}:${code}`,
  );

const messagesOf = (body: string) =>
  found(`schemaVersion: 1\nname: t\n${body}`).map(({ message }) => message);

const WORKER = "{ type: agent.worker, prompt: p }";
const TOOL = "{ type: tool.shell, command: prog }";

/** A Claude node `a`, a tool `b`, and an edge from one to the other. */
const fromWorker = (when: string) => `nodes:
  a: ${WORKER}
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "${when}" }
`;

const fromCall = (when: string) => `nodes:
  a: { type: workflow.call, workflow: other }
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "${when}" }
`;

const fromGate = (when: string) => `nodes:
  a: { type: human.gate, question: q, options: [approve, stop] }
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "${when}" }
`;

const fromSchema = (when: string) => `nodes:
  a:
    type: agent.worker
    prompt: p
    output: { schema: { status: [pass, done], verdict: [yes, no] } }
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "${when}" }
`;

const fromTool = (when: string) => `nodes:
  a:
    type: tool.shell
    command: prog
    output: { format: json, schema: { state: [OPEN, DONE], free: string } }
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "${when}" }
`;

const throughRouter = (when: string) => `nodes:
  a: ${WORKER}
  r: { type: control.router }
  b: ${TOOL}
edges:
  - a -> r
  - { from: r, to: b, when: "${when}" }
`;

const throughJoin = (other: string, when: string) => `nodes:
  a: ${WORKER}
  o: ${other}
  j: { type: control.join }
  b: ${TOOL}
edges:
  - a -> j
  - o -> j
  - { from: j, to: b, when: "${when}" }
`;

const ERROR = ["error:when.value"];

const FROM_SCHEMA =
  "{ type: agent.worker, prompt: p, output: { schema: { status: [pass, done] } } }";

const loopedRouter = (when: string) => `nodes:
  a: { type: human.gate, question: q, options: [start, cancel] }
  r: { type: control.router }
  b: { type: human.gate, question: q, options: [retry, quit] }
  out: ${TOOL}
edges:
  - a -> r
  - { from: r, to: out, when: "${when}" }
  - { from: r, to: b, when: "choice != 'x'" }
  - { from: b, to: r, maxRounds: 3 }
`;

/** Every code the compiler gives these nodes. */
const allCodesOf = (nodes: string): string[] => {
  const parsed = parseWorkflow(`schemaVersion: 1\nname: t\nnodes:\n${nodes}\n`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return compileWorkflow(parsed.workflow).diagnostics.map(({ code }) => code);
};

/** Every code the compiler gives a node declaring this. */
const statusCodesOf = (schema: string): string[] =>
  allCodesOf(
    `  a: { type: agent.worker, prompt: p, output: { schema: ${schema} } }`,
  );

describe("output.status", () => {
  it("leaves a tool's own field called status alone", () => {
    const codes = allCodesOf(
      '  a: { type: tool.shell, command: "true", output: { format: json, schema: { status: [ready] } } }',
    );
    expect(codes).not.toContain("output.status");
  });

  it("leaves a sub-agent alone, as it has no report of its own", () => {
    const codes = allCodesOf(`  lead: { type: agent.leader, prompt: p }
  helper:
    type: agent.subagent
    parent: lead
    description: d
    prompt: p
    output: { schema: { status: [approved] } }`);
    expect(codes).not.toContain("output.status");
  });

  it.each([
    ["a list", "{ status: [ready, blocked] }"],
    ["one value on the list too", "{ status: [pass, ready] }"],
    ["JSON Schema", "{ status: { enum: [ready] } }"],
  ])("refuses a status a session can't report: %s", (_, schema) => {
    expect(statusCodesOf(schema)).toContain("output.status");
  });

  it.each([
    ["narrowing the built-ins", "{ status: [pass] }"],
    ["another field", "{ verdict: [ready, blocked] }"],
  ])("takes %s", (_, schema) => {
    expect(statusCodesOf(schema)).not.toContain("output.status");
  });
});

describe("when.value", () => {
  it.each([
    ["a Claude status it can't report", fromWorker("status == 'failed'")],
    ["with != too", fromWorker("status != 'failed'")],
    ["with the value first", fromWorker("'failed' == status")],
    ["through output.", fromWorker("output.status == 'failed'")],
    ["inside &&", fromWorker("ok && status == 'failed'")],
    ["inside !", fromWorker("!(status == 'failed')")],
    ["a gate's option", fromGate("choice == 'aprove'")],
    ["a value outside a list", fromSchema("verdict == 'maybe'")],
    [
      "outside the node's own status",
      fromSchema("status == 'changes_requested'"),
    ],
    ["a tool's declared value", fromTool("json.state == 'CLOSED'")],
    ["through a router", throughRouter("status == 'failed'")],
    ["a join's statuses", throughJoin(WORKER, "any(statuses, 'failed')")],
  ])("refuses %s", (_name, body) => {
    expect(codesOf(body)).toEqual(ERROR);
  });

  it.each([
    ["a status it can report", fromWorker("status == 'pass'")],
    ["a gate's option", fromGate("choice == 'approve'")],
    ["the node's own status", fromSchema("status == 'done'")],
    ["`fail` beside its own statuses", fromSchema("status == 'fail'")],
    [
      "a join of its own statuses",
      throughJoin(FROM_SCHEMA, "any(statuses, 'fail')"),
    ],
    ["a router a loop comes back to", loopedRouter("choice == 'quit'")],
    ["a listed value", fromTool("json.state == 'OPEN'")],
    ["a free field", fromTool("json.free == 'anything'")],
    ["any status from a call", fromCall("status == 'done'")],
    ["a join with a tool's input", throughJoin(TOOL, "any(statuses, 'x')")],
    ["a join's real status", throughJoin(WORKER, "all(statuses, 'pass')")],
    ["a comparison with null", fromWorker("status != null")],
  ])("allows %s", (_name, body) => {
    expect(codesOf(body)).toEqual([]);
  });

  it("reads another node's field by its path", () => {
    expect(
      codesOf(`nodes:
  a: ${WORKER}
  c: ${TOOL}
  b: ${TOOL}
edges:
  - a -> c
  - { from: c, to: b, when: "nodes.a.output.status == 'failed'" }
`),
    ).toEqual(ERROR);
  });

  it("checks a notify rule's condition", () => {
    expect(
      codesOf(`nodes:
  lead: ${WORKER}
  a:
    type: agent.worker
    prompt: p
    notify:
      - { to: lead, when: "status == 'failed'" }
`),
    ).toEqual(ERROR);
  });

  it("says which values the field can have", () => {
    expect(messagesOf(fromGate("choice == 'aprove'"))).toEqual([
      "`choice` of `a` is never `aprove`: it can be `approve` or `stop`",
    ]);
  });
});

describe("when.never", () => {
  it("warns on a condition that reads nothing and is false", () => {
    expect(codesOf(fromWorker("false"))).toEqual(["warning:when.never"]);
  });

  it.each([
    ["always true", "true"],
    ["reading something", "ok"],
  ])("is quiet on one %s", (_name, when) => {
    expect(codesOf(fromWorker(when))).toEqual([]);
  });
});

/** Tools `a` and `b` looping, so only the shape of the loop can warn. */
const toolLoop = (loop: string, rest = "") => `nodes:
  a: ${TOOL}
  b: ${TOOL}
  c: ${TOOL}
edges:
  - a -> b
  - ${loop}
${rest}`;

describe("loop.no-condition", () => {
  it.each([
    ["no condition", "{ from: b, to: a, maxRounds: 3 }"],
    ["one always true", "{ from: b, to: a, when: 'true', maxRounds: 3 }"],
  ])("warns on a loop with %s", (_name, loop) => {
    expect(codesOf(toolLoop(loop))).toEqual(["warning:loop.no-condition"]);
  });

  it("is quiet when the loop edge has a condition", () => {
    expect(
      codesOf(
        toolLoop("{ from: b, to: a, when: 'exitCode > 0', maxRounds: 3 }"),
      ),
    ).toEqual([]);
  });

  it("is quiet when another edge of the loop has one", () => {
    expect(
      codesOf(`nodes:
  a: ${TOOL}
  b: ${TOOL}
edges:
  - { from: a, to: b, when: "exitCode > 0" }
  - { from: b, to: a, maxRounds: 3 }
`),
    ).toEqual([]);
  });
});

const beside = (mode: string) => `nodes:
  a: ${TOOL}
  r: { type: control.router, mode: ${mode} }
  c: ${TOOL}
edges:
  - a -> r
  - { from: r, to: a, when: "exitCode > 0", maxRounds: 3 }
  - r -> c
`;

describe("loop.beside-edge", () => {
  const CONDITIONED = "{ from: b, to: a, when: 'exitCode > 0', maxRounds: 3 }";

  it("warns on a plain edge from the node a loop edge leaves", () => {
    expect(codesOf(toolLoop(CONDITIONED, "  - b -> c\n"))).toEqual([
      "warning:loop.beside-edge",
    ]);
  });

  it("is quiet when that edge has a condition", () => {
    expect(
      codesOf(
        toolLoop(
          CONDITIONED,
          "  - { from: b, to: c, when: 'exitCode == 0' }\n",
        ),
      ),
    ).toEqual([]);
  });

  it("is quiet on a first-match router, where that edge is the fallback", () => {
    expect(codesOf(beside("first"))).toEqual([]);
  });

  it("warns on a router that takes every match", () => {
    expect(codesOf(beside("all"))).toEqual(["warning:loop.beside-edge"]);
  });
});

const sessions = (limits: string) => `nodes:
  a: ${WORKER}
  b: ${WORKER}
edges:
  - a -> b
  - { from: b, to: a, when: "status == 'fail'", maxRounds: 2 }
${limits}`;

describe("loop.uncapped", () => {
  it("warns on a loop of sessions, and says how many it can start", () => {
    expect(messagesOf(sessions(""))).toEqual([
      "this loop can start about 6 sessions, with no `limits.budgetUsd` or `limits.timeout` to stop them",
    ]);
  });

  it.each([
    ["a budget", "limits: { budgetUsd: 5 }\n"],
    ["a timeout", "limits: { timeout: 1h }\n"],
  ])("is quiet with %s", (_name, limits) => {
    expect(codesOf(sessions(limits))).toEqual([]);
  });

  it("is quiet on a loop of tools", () => {
    expect(
      codesOf(
        toolLoop("{ from: b, to: a, when: 'exitCode > 0', maxRounds: 9 }"),
      ),
    ).toEqual([]);
  });

  it("counts the sessions a leader in the loop owns", () => {
    expect(
      messagesOf(`nodes:
  a: { type: agent.leader, prompt: p }
  w: { type: agent.worker, prompt: p, parent: a }
  s: { type: agent.subagent, description: d, prompt: p, parent: a }
  b: ${TOOL}
edges:
  - a -> b
  - { from: b, to: a, when: "exitCode > 0", maxRounds: 1 }
`),
    ).toEqual([
      "this loop can start about 4 sessions, with no `limits.budgetUsd` or `limits.timeout` to stop them",
    ]);
  });
});

describe("the examples", () => {
  const files = readdirSync(examples).filter(name =>
    name.endsWith(".ork.yaml"),
  );

  it.each(files)("%s has nothing to report", name => {
    expect(found(readFileSync(path.join(examples, name), "utf8"))).toEqual([]);
  });
});
