/**
 * @file Tests for the context inspector's routes: a run's node is planned from
 *   its workflow file as it is now, saying when the file changed after the run
 *   started; a builder's node follows the draft; a node that can't be planned
 *   says why; and an unknown run, project or workflow is a 404.
 */

import { utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CallResult, NodeContextAnswer } from "../src/index.ts";
import { startTestServer, type TestServer } from "./fixtures.ts";

let fixture: TestServer;

beforeEach(async () => {
  fixture = await startTestServer();
});

afterEach(async () => {
  await fixture.close();
});

const WORKFLOW = [
  "schemaVersion: 1",
  "name: fixit",
  "layers:",
  "  context: [./style.md]",
  "nodes:",
  "  fix:",
  "    type: agent.worker",
  "  run:",
  "    type: tool.shell",
  '    command: "true"',
  '    allow: ["true"]',
  "",
].join("\n");

const inWorkflows = (name: string): string =>
  path.join(fixture.project.dir, "workflows", name);

/** The `fixit` workflow, written a minute ago, and a run of it begun now. */
const runOfFixit = (): string => {
  const file = inWorkflows("fixit.ork.yaml");
  writeFileSync(inWorkflows("style.md"), "Be brief.\n");
  writeFileSync(file, WORKFLOW);
  const minuteAgo = new Date(Date.now() - 60_000);
  utimesSync(file, minuteAgo, minuteAgo);
  utimesSync(inWorkflows("style.md"), minuteAgo, minuteAgo);
  fixture.store.begin({
    id: "run1",
    workflow: "fixit",
    file,
    project: fixture.project.root,
  });
  return file;
};

const answered = async (call: Promise<CallResult<NodeContextAnswer>>) => {
  const result = await call;
  if (!result.ok) throw new Error(result.error);
  return result.data;
};

const runContext = (node: string, id = "run1") =>
  fixture.client.call("runContext", { params: { id, node } });

const builderContext = (node: string, name = "fixit") =>
  fixture.client.call("builderContext", {
    params: { id: "demo", name, node },
  });

/** The names of the context files an answer plans. */
const filesOf = (answer: NodeContextAnswer): string[] =>
  answer.planned ? answer.explanation.files.map(f => f.name) : [];

describe("a run's node's context", () => {
  it("is planned from the run's workflow file, with each piece's words", async () => {
    runOfFixit();
    const answer = await answered(runContext("fix"));
    expect(answer).toMatchObject({
      planned: true,
      changedSinceStart: [],
      explanation: {
        node: "fix",
        files: [{ layer: "workflow", text: "Be brief.\n" }],
      },
    });
  });

  it("names each file behind it that changed after the run started", async () => {
    const file = runOfFixit();
    const later = new Date(Date.now() + 60_000);
    utimesSync(file, later, later);
    utimesSync(inWorkflows("style.md"), later, later);
    expect(await answered(runContext("fix"))).toMatchObject({
      planned: true,
      changedSinceStart: [
        ".ork/workflows/fixit.ork.yaml",
        ".ork/workflows/style.md",
      ],
    });
  });

  it("says why a node can't be planned", async () => {
    runOfFixit();
    expect(await answered(runContext("run"))).toEqual({
      planned: false,
      why: "`run` is a `tool.shell`, not a Claude node",
      changedSinceStart: [],
    });
  });

  it("is a 404 for a run there isn't", async () => {
    expect(await runContext("fix", "nope")).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("a builder's node's context", () => {
  it("follows the draft before it's saved", async () => {
    runOfFixit();
    writeFileSync(inWorkflows("more.md"), "And kind.\n");
    expect(filesOf(await answered(builderContext("fix")))).toEqual([
      ".ork/workflows/style.md",
    ]);
    await fixture.client.call("builderRestore", {
      params: { id: "demo", name: "fixit" },
      body: {
        text: WORKFLOW.replace("[./style.md]", "[./style.md, ./more.md]"),
        baseHash: null,
      },
    });
    expect(filesOf(await answered(builderContext("fix")))).toEqual([
      ".ork/workflows/style.md",
      ".ork/workflows/more.md",
    ]);
  });

  it("is a 404 for a workflow or project there isn't", async () => {
    expect(await builderContext("fix", "nope")).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      await fixture.client.call("builderContext", {
        params: { id: "nope", name: "fixit", node: "fix" },
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});
