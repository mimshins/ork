/**
 * @file Tests for `ork mcp`'s `check` and `start_run` (RFC-012): `check` says
 *   what `ork validate` says of a draft or a file, with lines and the walk, and
 *   `start_run` starts a run as `ork run --detach` does, where it's offered.
 */

import { storePath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { openMcp, type OpenMcp } from "../src/index.ts";
import {
  fakeOrk,
  readArgs,
  startTestServer,
  type TestServer,
} from "./fixtures.ts";

let fixture: TestServer | undefined;
let mcp: OpenMcp | undefined;

afterEach(async () => {
  mcp?.close();
  mcp = undefined;
  await fixture?.close();
  fixture = undefined;
});

const opened = async (start = false) => {
  fixture = await startTestServer();
  const fake = fakeOrk(storePath(fixture.home));
  mcp = openMcp({
    version: "9.9.9",
    home: fixture.home,
    script: fake.script,
    start,
  });
  return { mcp, args: () => readArgs(fake.args) };
};

const call = (name: string, args: unknown) => {
  const tool = mcp?.tools.find(each => each.name === name);
  if (tool === undefined) throw new Error(`No tool ${name}`);
  return tool.call(args);
};

const parsed = async (name: string, args: unknown): Promise<unknown> =>
  JSON.parse((await call(name, args)).text) as unknown;

const GATED = [
  "schemaVersion: 1",
  "name: draft",
  "nodes:",
  "  ask: { type: human.gate, question: Ship?, options: [yes, no] }",
  "  ship: { type: tool.shell, command: 'true', allow: ['true'] }",
  "edges:",
  "  - { from: ask, to: ship, when: \"choice == 'yse'\" }",
  "",
].join("\n");

describe("ork mcp's check", () => {
  it("checks a draft's text, with each problem's line", async () => {
    await opened();
    expect(
      await parsed("check", { project: "demo", text: GATED }),
    ).toMatchObject({
      errors: 1,
      diagnostics: [{ code: "when.value", line: 7 }],
    });
  });

  it("walks a clean one, and lists its endings on request", async () => {
    await opened();
    const clean = GATED.replace("'yse'", "'yes'");
    expect(
      await parsed("check", { project: "demo", text: clean, paths: true }),
    ).toMatchObject({
      errors: 0,
      walk: expect.stringMatching(/^Walked \d+ ways? through/u) as unknown,
      endings: expect.arrayContaining([
        expect.objectContaining({ status: "succeeded" }),
      ]) as unknown,
    });
  });

  it("checks a workflow file by name", async () => {
    await opened();
    expect(
      await parsed("check", { project: "demo", workflow: "demo" }),
    ).toMatchObject({ errors: expect.any(Number) as unknown });
  });

  it("wants a workflow or text, not both or neither", async () => {
    await opened();
    expect((await call("check", { project: "demo" })).isError).toBe(true);
    expect(
      (await call("check", { project: "demo", workflow: "demo", text: GATED }))
        .isError,
    ).toBe(true);
    expect(
      (await call("check", { project: "nope", text: GATED })).isError,
    ).toBe(true);
  });
});

describe("ork mcp's start_run", () => {
  it("is offered only where starting is allowed", async () => {
    const { mcp: tools } = await opened(false);
    expect(tools.tools.map(({ name }) => name)).not.toContain("start_run");
  });

  it("starts a run in the background, as `ork run --detach` does", async () => {
    const { args } = await opened(true);
    expect(
      await parsed("start_run", {
        project: "demo",
        workflow: "demo",
        inputs: { branch: "main" },
      }),
    ).toMatchObject({ runId: expect.any(String) as unknown });
    expect(args().argv).toEqual(
      expect.arrayContaining(["run", "--input", "branch=main", "--run-id"]),
    );
  });

  it("refuses a workflow it can't find", async () => {
    await opened(true);
    expect(
      (await call("start_run", { project: "demo", workflow: "nope" })).isError,
    ).toBe(true);
  });

  it("is the only tool not marked read-only", async () => {
    const { mcp: tools } = await opened(true);
    expect(
      tools.tools.filter(({ readOnly }) => !readOnly).map(({ name }) => name),
    ).toEqual(["start_run"]);
  });
});
