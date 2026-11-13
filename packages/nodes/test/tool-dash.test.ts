/**
 * @file Tests for the leading-`-` guard on a tool node's command: an argument
 *   that starts with a template reading `nodes.*.output` and renders to a
 *   leading `-` would read as an option, so it fails the node unless `--` comes
 *   before it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecuteContext } from "@krapht/ork-core";
import type { Node } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { toolExecutor, type ToolRunner } from "../src/index.ts";

const runCommand = async (command: string, ref: string) => {
  const node: Node = { type: "tool.shell", command };
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-tool-dash-"));
  const context: ExecuteContext = {
    runId: "r1",
    id: "n",
    node,
    workflow: { schemaVersion: 1, name: "wf", nodes: { n: node } },
    inputs: {},
    outputs: { a: { ref } },
    input: undefined,
    round: 1,
    cwd,
    runDir: path.join(cwd, "runs"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: () => {},
    signal: new AbortController().signal,
  };
  const calls: (readonly string[])[] = [];
  const runner: ToolRunner = (_program, args) => {
    calls.push(args);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };
  const result = await toolExecutor(runner, { environ: {} })(context);
  return { result, calls };
};

describe("a tool node's templated arguments", () => {
  it("fails on an output that starts with `-`, and never runs", async () => {
    const { result, calls } = await runCommand(
      "echo {{ nodes.a.output.ref }}",
      "--output=x",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain(
      "argument from nodes.a.output starts with `-`; put `--` before it in the command",
    );
    expect(calls).toEqual([]);
  });

  it("runs the same output after `--`", async () => {
    const { result, calls } = await runCommand(
      "echo -- {{ nodes.a.output.ref }}",
      "--output=x",
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["--", "--output=x"]]);
  });

  it("leaves a literal option and a `--flag={{…}}` token alone", async () => {
    const { result, calls } = await runCommand(
      "echo -x --flag={{ nodes.a.output.ref }}",
      "v1",
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["-x", "--flag=v1"]]);
  });
});
