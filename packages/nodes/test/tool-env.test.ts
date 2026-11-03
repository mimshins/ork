/**
 * @file Tests for what a tool node's program sees and returns: who it is, its
 *   `env:`, values from the user's environment scrubbed from what it prints,
 *   and a JSON result from `$ORK_OUTPUT` or stdout.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecuteContext, RuntimeEvent } from "@krapht/ork-core";
import type { Node, ToolNode } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  envReadsOf,
  missingEnv,
  OUTPUT_LIMIT,
  scrubberOf,
  sessionEnv,
  spawnTool,
  startedByARun,
  toolExecutor,
  type ToolRun,
  type ToolRunner,
  withoutIdentity,
} from "../src/index.ts";

const SECRET = "s3cret-value-123";

const shell = (over: Partial<ToolNode> = {}): Node => ({
  type: "tool.shell",
  command: "prog",
  ...over,
});

const json = (over: Partial<ToolNode> = {}) =>
  shell({ output: { format: "json" }, ...over });

/** The file a runner is told to write its result to. */
const outputFileOf = (env: Readonly<Record<string, string>>): string =>
  String(env["ORK_OUTPUT"]);

const context = (
  node: Node,
  over: Partial<ExecuteContext> = {},
): ExecuteContext & { events: RuntimeEvent[] } => {
  const events: RuntimeEvent[] = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-tool-env-"));
  return {
    runId: "r1",
    id: "n",
    node,
    workflow: { schemaVersion: 1, name: "wf", nodes: { n: node } },
    inputs: { who: "me" },
    outputs: { a: { json: { state: "OPEN" } } },
    input: undefined,
    round: 2,
    cwd,
    runDir: path.join(cwd, "runs"),
    workflowDir: cwd,
    projectRoot: cwd,
    budgetLeftUsd: undefined,
    human: {
      ask: () => Promise.resolve(""),
      permit: () => Promise.resolve({ allow: true }),
    },
    emit: event => {
      events.push(event);
    },
    signal: new AbortController().signal,
    events,
    ...over,
  };
};

/** A runner that answers with `run`, and first does `act` with its env. */
const runnerOf = (
  run: Partial<ToolRun>,
  act?: (env: Readonly<Record<string, string>>) => void,
) => {
  const seen: Readonly<Record<string, string>>[] = [];
  const runner: ToolRunner = (_program, _args, options) => {
    const env = options.env ?? {};
    seen.push(env);
    act?.(env);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", ...run });
  };
  return { runner, seen };
};

const environ = { MY_TOKEN: SECRET, SHORT: "1" };

describe("a tool node's environment", () => {
  it("tells the program who it is", async () => {
    const run = context(shell());
    const { runner, seen } = runnerOf({});
    await toolExecutor(runner, { orkBin: "/bin/ork" })(run);
    expect(seen[0]).toEqual({
      ORK_RUN: "r1",
      ORK_NODE: "n",
      ORK_ROUND: "2",
      ORK_RUN_DIR: run.runDir,
      ORK_PROJECT: run.projectRoot,
      ORK_WORKFLOW: "wf",
      ORK_BIN: "/bin/ork",
    });
  });

  it("reaches a real program, which keeps what it inherits", async () => {
    const run = context(
      shell({ command: `sh -c 'echo "$ORK_NODE $ORK_ROUND $HOME"'` }),
    );
    const result = await toolExecutor(spawnTool)(run);
    expect(result.output["stdout"]).toBe(
      `n 2 ${String(process.env["HOME"])}\n`,
    );
  });

  it("renders `env:` from the run and from the user's variables", async () => {
    const run = context(
      shell({
        env: {
          STATE: "{{nodes.a.output.json.state}}",
          WHO: "{{inputs.who}}",
          TOKEN: "{{env.MY_TOKEN}}",
          PLAIN: "x",
        },
      }),
    );
    const { runner, seen } = runnerOf({});
    await toolExecutor(runner, { environ })(run);
    expect(seen[0]).toMatchObject({
      STATE: "OPEN",
      WHO: "me",
      TOKEN: SECRET,
      PLAIN: "x",
    });
  });

  it("fails a node whose variable is not set, rather than run with nothing", async () => {
    const run = context(shell({ env: { TOKEN: "{{env.GONE}}" } }));
    const { runner, seen } = runnerOf({});
    const result = await toolExecutor(runner, { environ })(run);
    expect(result.error).toBe("env.TOKEN reads GONE, which is not set");
    expect(seen).toEqual([]);
  });

  it("records only the names of `env:`", async () => {
    const run = context(shell({ env: { TOKEN: "{{env.MY_TOKEN}}" } }));
    await toolExecutor(runnerOf({}).runner, { environ })(run);
    expect(run.events[0]).toMatchObject({
      type: "tool.called",
      input: { command: "prog", env: ["TOKEN"] },
    });
    expect(JSON.stringify(run.events)).not.toContain(SECRET);
  });

  it("scrubs the user's value from what the program prints", async () => {
    const run = context(
      shell({ env: { TOKEN: "{{env.MY_TOKEN}}" }, output: { format: "json" } }),
    );
    const stdout = JSON.stringify({ token: SECRET });
    const { runner } = runnerOf({ stdout, stderr: `used ${SECRET}` });
    const result = await toolExecutor(runner, { environ })(run);
    expect(JSON.stringify(result.output)).not.toContain(SECRET);
    expect(result.output["json"]).toEqual({ token: "[masked]" });
    expect(result.output["stderr"]).toBe("used [masked]");
  });

  it("scrubs a value from a failure's error and from long output's file", async () => {
    const run = context(shell({ env: { TOKEN: "{{env.MY_TOKEN}}" } }));
    const stdout = `${SECRET}${"x".repeat(OUTPUT_LIMIT)}`;
    const { runner } = runnerOf({ exitCode: 3, stdout, stderr: SECRET });
    const result = await toolExecutor(runner, { environ })(run);
    expect(result.error).not.toContain(SECRET);
    const file = path.join(run.runDir, "n.2.stdout.txt");
    expect(readFileSync(file, "utf8")).not.toContain(SECRET);
  });

  it("leaves short values alone, or every `1` would be masked", () => {
    expect(scrubberOf(["1", "true"])("1 true")).toBe("1 true");
    expect(scrubberOf(["abcdefgh"])("xabcdefghx")).toBe("x[masked]x");
  });

  it("lists variables that are not set, once each, with their nodes", () => {
    const workflow = {
      schemaVersion: 1 as const,
      name: "w",
      nodes: {
        a: shell({ env: { X: "{{env.GONE}}", Y: "{{env.MY_TOKEN}}" } }),
        b: shell({ env: { X: "{{env.GONE}}" } }),
      },
    };
    expect(missingEnv(workflow, environ)).toEqual([
      { variable: "GONE", nodes: ["a", "b"] },
    ]);
    expect(envReadsOf("{{env.A}}-{{inputs.b}}")).toEqual(["A"]);
  });

  it("gives a Claude session only the marker", () => {
    expect(sessionEnv({ ORK_RUN: "r", ORK_NODE: "n", KEEP: "1" })).toEqual({
      KEEP: "1",
      ORK_SESSION: "1",
    });
    expect(startedByARun(sessionEnv({}))).toBe(true);
    expect(startedByARun({ ORK_RUN: "r" })).toBe(true);
    expect(startedByARun({ KEEP: "1" })).toBe(false);
  });

  it("does not pass one run's identity on to the next", () => {
    expect(
      withoutIdentity({ ORK_RUN: "r", ORK_OUTPUT: "f", KEEP: "1" }),
    ).toEqual({ KEEP: "1" });
  });
});

describe("a tool node's JSON result", () => {
  it("reads stdout, and keeps the usual fields", async () => {
    const run = context(json());
    const { runner } = runnerOf({ stdout: '{"state":"OPEN"}' });
    const result = await toolExecutor(runner)(run);
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      exitCode: 0,
      stdout: '{"state":"OPEN"}',
      stderr: "",
      json: { state: "OPEN" },
    });
  });

  it("takes the file over stdout, and removes it", async () => {
    const run = context(json());
    let file = "";
    const { runner } = runnerOf({ stdout: "plain logs" }, env => {
      file = outputFileOf(env);
      writeFileSync(file, '{"from":"file"}');
    });
    const result = await toolExecutor(runner)(run);
    expect(result.output["json"]).toEqual({ from: "file" });
    expect(result.output["stdout"]).toBe("plain logs");
    expect(existsSync(file)).toBe(false);
  });

  it("does not read a file an earlier go left", async () => {
    const run = context(json());
    const first = runnerOf({}, env => {
      writeFileSync(outputFileOf(env), '{"go":1}');
    });
    await toolExecutor(first.runner)(run);
    const again = await toolExecutor(runnerOf({ stdout: '{"go":2}' }).runner)(
      run,
    );
    expect(again.output["json"]).toEqual({ go: 2 });
  });

  it("fails on invalid or empty JSON, keeping the exit code", async () => {
    const run = context(json());
    const bad = await toolExecutor(runnerOf({ stdout: "nope" }).runner)(run);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("n: stdout is not valid JSON");
    expect(bad.output["exitCode"]).toBe(0);
    const empty = await toolExecutor(runnerOf({ stdout: " \n" }).runner)(run);
    expect(empty.error).toBe("n: stdout is empty");
  });

  it("fails on a bad file rather than falling back to stdout", async () => {
    const run = context(json());
    const { runner } = runnerOf({ stdout: '{"ok":true}' }, env => {
      writeFileSync(outputFileOf(env), "{");
    });
    const result = await toolExecutor(runner)(run);
    expect(result.error).toContain("n: $ORK_OUTPUT is not valid JSON");
  });

  it("does not parse a program that failed, and leaves no file", async () => {
    const run = context(json());
    let file = "";
    const { runner } = runnerOf({ exitCode: 2, stdout: "nope" }, env => {
      file = outputFileOf(env);
      writeFileSync(file, "{}");
    });
    const result = await toolExecutor(runner)(run);
    expect(result.error).toBe("prog exited with 2");
    expect(result.output["json"]).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it("parses all of stdout past the text limit, and never cuts the result", async () => {
    const small = '"' + "y".repeat(OUTPUT_LIMIT - 10) + '"';
    const padded = `${small}${" ".repeat(OUTPUT_LIMIT)}`;
    const fits = await toolExecutor(runnerOf({ stdout: padded }).runner)(
      context(json()),
    );
    expect(fits.ok).toBe(true);
    const run = context(json());
    const big = JSON.stringify("z".repeat(OUTPUT_LIMIT));
    const tooBig = await toolExecutor(runnerOf({ stdout: big }).runner)(run);
    expect(tooBig.ok).toBe(false);
    expect(tooBig.error).toContain(path.join(run.runDir, "n.2.json.txt"));
    expect(tooBig.output["json"]).toBeUndefined();
  });

  it("gives no file to a node that does not ask for JSON", async () => {
    const { runner, seen } = runnerOf({ stdout: "{}" });
    const result = await toolExecutor(runner)(context(shell()));
    expect(seen[0]?.["ORK_OUTPUT"]).toBeUndefined();
    expect(result.output["json"]).toBeUndefined();
  });
});
