/**
 * @file Tests for what a tool node's program sees and returns: who it is, its
 *   `env:`, values from the user's environment scrubbed from what it prints,
 *   and a JSON result from `$ORK_OUTPUT` or stdout.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  envReadsOf,
  type ExecuteContext,
  type ProjectPlace,
  type RuntimeEvent,
} from "@krapht/ork-core";
import type { Node, ToolNode } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  calledEnvWarning,
  clearOutputFiles,
  maskedEnv,
  maskedNamesOfRun,
  missingEnv,
  OUTPUT_LIMIT,
  scrubberOf,
  sessionEnv,
  spawnTool,
  runMarkerIn,
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

  it("keeps a list or object as JSON in `env:` (ADR-047), not gate text", async () => {
    const run = context(
      shell({
        env: {
          LIST: "{{nodes.a.output.list}}",
          OBJECT: "{{nodes.a.output.object}}",
        },
      }),
      { outputs: { a: { list: ["x", "y"], object: { k: 1 } } } },
    );
    const { runner, seen } = runnerOf({});
    await toolExecutor(runner, { environ })(run);
    expect(seen[0]).toMatchObject({ LIST: '["x","y"]', OBJECT: '{"k":1}' });
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
    expect(runMarkerIn(sessionEnv({}))).toBe("ORK_SESSION");
    expect(runMarkerIn({ ORK_RUN: "r" })).toBe("ORK_RUN");
    expect(runMarkerIn({ KEEP: "1" })).toBeNull();
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

  it("fails a node whose JSON isn't what it declared, and leaves it out", async () => {
    const node = json({
      output: { format: "json", schema: { state: ["OPEN", "CLOSED"] } },
    });
    const passing = await toolExecutor(
      runnerOf({ stdout: '{"state":"OPEN"}' }).runner,
    )(context(node));
    expect(passing.ok).toBe(true);
    const events: unknown[] = [];
    const run = {
      ...context(node),
      emit: (event: unknown) => events.push(event),
    };
    const result = await toolExecutor(
      runnerOf({ stdout: '{"state":"DRAFT"}' }).runner,
    )(run);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("state is `DRAFT`, expected `OPEN` or `CLOSED`");
    // What it didn't declare isn't its output, so no condition can read it.
    expect(result.output["json"]).toBeUndefined();
    expect(result.output["stdout"]).toContain("DRAFT");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool.result", isError: true }),
    );
  });

  it("gives no file to a node that does not ask for JSON", async () => {
    const { runner, seen } = runnerOf({ stdout: "{}" });
    const result = await toolExecutor(runner)(context(shell()));
    expect(seen[0]?.["ORK_OUTPUT"]).toBeUndefined();
    expect(result.output["json"]).toBeUndefined();
  });
});

const PARENT = {
  schemaVersion: 1 as const,
  name: "parent",
  nodes: {
    call: { type: "workflow.call" as const, workflow: "child" },
    later: { type: "workflow.call" as const, workflow: "{{inputs.which}}" },
  },
};

/** A project with a workflow `child`, which calls `parent` back. */
const calledPlace = (): ProjectPlace => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-called-"));
  const dir = path.join(root, ".ork", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "child.ork.yaml"),
    `schemaVersion: 1
name: child
nodes:
  deploy:
    type: tool.shell
    command: prog
    env: { T: "{{env.CHILD_TOKEN}}" }
  region:
    type: tool.shell
    command: prog
    env: { R: "{{env.REGION}}" }
    plainEnv: [REGION]
  again: { type: workflow.call, workflow: parent }
`,
  );
  return { mode: "in-repo", root, dir: path.join(root, ".ork") };
};

/** Runs a JSON node reading `MY_TOKEN`, and everything that was recorded. */
const runJson = async (
  stdout: string,
  env: Record<string, string> = environ,
  over: Partial<ToolNode> = {},
) => {
  const run = context(json({ env: { T: "{{env.MY_TOKEN}}" }, ...over }));
  const result = await toolExecutor(runnerOf({ stdout }).runner, {
    environ: env,
  })(run);
  return { result, recorded: JSON.stringify([result, run.events]) };
};

describe("a secret in what a program returns", () => {
  it("is not quoted by a JSON parse error", async () => {
    const { result, recorded } = await runJson(SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("n: stdout is not valid JSON");
    expect(recorded).not.toContain(SECRET);
  });

  it("is masked in JSON keys and in numbers", async () => {
    const { result, recorded } = await runJson(
      `{"${SECRET}":1,"pin":123456789,"n":7,"list":["${SECRET}"]}`,
      { MY_TOKEN: SECRET, PIN: "123456789" },
      { env: { T: "{{env.MY_TOKEN}}", P: "{{env.PIN}}" } },
    );
    expect(result.output).toMatchObject({
      json: {
        "[masked]": 1,
        pin: "[masked]",
        n: 7,
        list: ["[masked]"],
      },
    });
    expect(recorded).not.toContain("123456789");
  });

  it.each([
    ["quotes and backslashes", String.raw`pa"ss\word-long`],
    ["several lines", "line-one\nline-two\nline-three"],
    ["a slash, escaped by some encoders", "abc/def/ghi"],
  ])("is masked in stdout when escaped: %s", async (_name, value) => {
    const stdout = JSON.stringify({ t: value });
    const { result } = await runJson(stdout, { MY_TOKEN: value });
    expect(result.output).toMatchObject({
      json: { t: "[masked]" },
      stdout: `{"t":"[masked]"}`,
    });
  });

  it.each([
    ["Go, which escapes & < >", "p&w<d>-long", String.raw`p&w<d>-long`],
    [
      "PHP, which escapes / and non-ASCII",
      "pä/ss/word",
      String.raw`pä\/ss\/word`,
    ],
    ["PHP in another case", "pä/ss/word", String.raw`pä\/ss\/word`],
    [
      "Python, which escapes non-ASCII",
      "pässwörd-long",
      String.raw`pässwörd-long`,
    ],
    [
      "a quote and a backslash",
      String.raw`pa"ss\word`,
      String.raw`pa\"ss\\word`,
    ],
    ["an emoji, as two escapes", "tok😀en-long", String.raw`tok😀en-long`],
  ])("is masked as %s writes it", (_name, value, printed) => {
    expect(scrubberOf([value])(`before ${printed} after`)).toBe(
      "before [masked] after",
    );
  });

  it.each([
    ["over the old limit", 6000],
    ["much larger", 65_000],
  ])("is masked at any size: %s", async (_name, size) => {
    const value = "abcDEF123/".repeat(size / 10);
    const { result, recorded } = await runJson(`{"v":"${value}"}`, {
      MY_TOKEN: value,
    });
    expect(result.ok).toBe(true);
    expect(recorded).not.toContain(value.slice(0, 40));
  });

  it("is not slow on a value built to be", () => {
    const repeated = `${"a".repeat(4095)}b`;
    const slashes = `${"\\".repeat(36)}X`;
    const started = performance.now();
    scrubberOf([repeated])("a".repeat(4 * 1024 * 1024));
    scrubberOf([slashes])(`${"\\".repeat(72)}Y`);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("is masked in the values of a JSON document", async () => {
    const value = JSON.stringify({
      type: "service_account",
      private_key: "key-material-1234",
      project: 1_234_567_890,
      list: ["inner-secret-value"],
    });
    const { result, recorded } = await runJson(value, { MY_TOKEN: value });
    expect(result.output).toMatchObject({
      json: {
        private_key: "[masked]",
        project: "[masked]",
        list: ["[masked]"],
      },
    });
    expect(recorded).not.toContain("key-material");
  });

  it("is masked line by line when a program reshapes it", () => {
    const pem = "-----BEGIN KEY-----\nabcdefgh12345678\n-----END KEY-----";
    const scrub = scrubberOf([pem]);
    expect(scrub(pem.replaceAll("\n", " "))).toBe("[masked] [masked] [masked]");
    expect(scrub(pem.replaceAll("\n", "\r\n"))).toBe(
      "[masked]\r\n[masked]\r\n[masked]",
    );
    expect(scrub("got abcdefgh12345678 here")).toBe("got [masked] here");
  });

  it("is masked when JSON is inside JSON", () => {
    const value = 'pa"ss\nword-long';
    const twice = JSON.stringify(JSON.stringify({ v: value }));
    const scrub = scrubberOf([value]);
    expect(scrub(twice)).not.toContain("word-long");
  });

  it("leaves no tail when two secrets overlap", () => {
    const scrub = scrubberOf(["abcdefgh12345678", "12345678zzzzzzzz"]);
    expect(scrub("abcdefgh12345678zzzzzzzz!")).toBe("[masked]!");
  });

  it("does not mask spaces for a value that is only spaces", () => {
    expect(scrubberOf(["        "])("a        b")).toBe("a        b");
  });

  it("is masked in a number written another way", async () => {
    const { result } = await runJson(`{"a":1.2345678e7}`, {
      MY_TOKEN: "12345678",
    });
    expect(result.output).toMatchObject({ json: { a: "[masked]" } });
  });

  it("keeps every value when masked keys meet a key of that name", async () => {
    const { result } = await runJson(
      `{"12345678":1,"abcdefgh":2,"[masked] 2":3}`,
      { MY_TOKEN: "12345678", OTHER: "abcdefgh" },
      { env: { T: "{{env.MY_TOKEN}}", O: "{{env.OTHER}}" } },
    );
    expect(result.output).toMatchObject({
      json: { "[masked]": 1, "[masked] 3": 2, "[masked] 2": 3 },
    });
  });

  it("is masked in what is recorded of a command", async () => {
    const node = shell({
      command: "prog {{inputs.who}}",
      env: { T: "{{env.MY_TOKEN}}" },
    });
    const run = context(node, { inputs: { who: SECRET } });
    await toolExecutor(runnerOf({}).runner, { environ })(run);
    expect(JSON.stringify(run.events)).not.toContain(SECRET);
    expect(JSON.stringify(run.events)).toContain("prog [masked]");
  });

  it("is masked in an allow refusal", async () => {
    const node = shell({
      command: "prog {{inputs.who}}",
      allow: ["other"],
      env: { T: "{{env.MY_TOKEN}}" },
    });
    const run = context(node, { inputs: { who: SECRET } });
    const result = await toolExecutor(runnerOf({}).runner, { environ })(run);
    expect(result.error).not.toContain(SECRET);
  });

  it("is masked in the name of a program that fails", async () => {
    const node = shell({
      command: "{{inputs.who}}",
      env: { T: "{{env.MY_TOKEN}}" },
    });
    const run = context(node, { inputs: { who: SECRET } });
    const result = await toolExecutor(runnerOf({ exitCode: 3 }).runner, {
      environ,
    })(run);
    expect(result.error).toBe("[masked] exited with 3");
  });

  it("is masked when printed without its stray whitespace", () => {
    expect(scrubberOf(["s3cret-value\r"])("got s3cret-value.")).toBe(
      "got [masked].",
    );
  });

  it("treats a value's special characters as text", () => {
    const scrub = scrubberOf(["a.b*c+d(e)[f]"]);
    expect(scrub("axbcccd")).toBe("axbcccd");
    expect(scrub("a.b*c+d(e)[f]")).toBe("[masked]");
  });

  it.each([
    ["too long for a number", "12345678901234567890"],
    ["printed in another form", "1000000000000000000000"],
    ["with trailing zeros", "3.1400000000"],
  ])("is masked in a number %s", async (_name, value) => {
    const { result, recorded } = await runJson(`{"n":${value}}`, {
      MY_TOKEN: value,
    });
    expect(result.output).toMatchObject({ json: { n: "[masked]" } });
    expect(recorded).not.toContain(value.slice(0, 12));
  });

  it("keeps both values when two secrets are keys", async () => {
    const { result } = await runJson(
      `{"${SECRET}":1,"other-secret-value":2}`,
      { MY_TOKEN: SECRET, OTHER: "other-secret-value" },
      { env: { T: "{{env.MY_TOKEN}}", O: "{{env.OTHER}}" } },
    );
    expect(result.output).toMatchObject({
      json: { "[masked]": 1, "[masked] 2": 2 },
    });
  });

  it("says when JSON is too deep, rather than invalid", async () => {
    const deep = `${"[".repeat(200_000)}${"]".repeat(200_000)}`;
    const { result } = await runJson(deep);
    expect(result.error).toBe("n: stdout is nested too deeply to read");
  });

  it("is masked when the run's caller reads it", async () => {
    const run = context(shell());
    const result = await toolExecutor(
      runnerOf({ stdout: `leaked ${SECRET}` }).runner,
      { environ: { MY_TOKEN: SECRET, ...maskedEnv(["MY_TOKEN"]) } },
    )(run);
    expect(result.output).toMatchObject({ stdout: "leaked [masked]" });
  });

  it("is masked when a name is given for the workflows it calls", async () => {
    const run = context(shell());
    const result = await toolExecutor(
      runnerOf({ stdout: `leaked ${SECRET}` }).runner,
      { environ, maskedNames: ["MY_TOKEN"] },
    )(run);
    expect(result.output).toMatchObject({ stdout: "leaked [masked]" });
  });

  it("is masked in a node that did not read it", async () => {
    const reader = shell({ env: { T: "{{env.MY_TOKEN}}" } });
    const printer = shell();
    const run = context(printer, {
      workflow: {
        schemaVersion: 1,
        name: "wf",
        nodes: { reader, n: printer },
      },
    });
    const result = await toolExecutor(
      runnerOf({ stdout: `leaked ${SECRET}` }).runner,
      { environ },
    )(run);
    expect(result.output).toMatchObject({ stdout: "leaked [masked]" });
  });

  it("is kept when a node says the variable is not secret", async () => {
    const { result } = await runJson(
      `{"region":"us-east-1"}`,
      { REGION: "us-east-1" },
      { env: { R: "{{env.REGION}}" }, plainEnv: ["REGION"] },
    );
    expect(result.output).toMatchObject({ json: { region: "us-east-1" } });
  });

  it("is masked unless every node reading it says it is not secret", async () => {
    const plain = shell({
      env: { R: "{{env.REGION}}" },
      plainEnv: ["REGION"],
    });
    const other = shell({ env: { R: "{{env.REGION}}" } });
    const run = context(plain, {
      workflow: { schemaVersion: 1, name: "wf", nodes: { n: plain, other } },
    });
    const result = await toolExecutor(
      runnerOf({ stdout: "us-east-1" }).runner,
      { environ: { REGION: "us-east-1" } },
    )(run);
    expect(result.output).toMatchObject({ stdout: "[masked]" });
  });

  it("is not printed when a rendered value has a null byte", async () => {
    const node = shell({
      env: { X: "{{env.MY_TOKEN}}{{nodes.a.output.text}}" },
    });
    const run = context(node, { outputs: { a: { text: "x\0y" } } });
    const result = await toolExecutor(spawnTool, { environ })(run);
    expect(result.error).toBe("env.X holds a null byte");
    expect(JSON.stringify([result, run.events])).not.toContain(SECRET);
  });

  it("is not printed when the runner itself throws", async () => {
    const run = context(shell({ env: { T: "{{env.MY_TOKEN}}" } }));
    const runner: ToolRunner = () =>
      Promise.reject(new Error(`could not start with ${SECRET}`));
    const result = await toolExecutor(runner, { environ })(run);
    expect(result.ok).toBe(false);
    expect(JSON.stringify([result, run.events])).not.toContain(SECRET);
  });
});

describe("where a program's result waits", () => {
  it("is a private folder, cleared as a run starts and ends", async () => {
    const run = context(json());
    let file = "";
    const { runner } = runnerOf({ stdout: "{}" }, env => {
      file = outputFileOf(env);
      writeFileSync(file, "{}");
    });
    await toolExecutor(runner, { environ })(run);
    const folder = path.dirname(file);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    writeFileSync(file, SECRET);
    const warnings: string[] = [];
    clearOutputFiles(run.runDir, line => {
      warnings.push(line);
    });
    expect(existsSync(folder)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("warns, rather than throws, when the folder will not go", async () => {
    const run = context(json());
    const { runner } = runnerOf({ stdout: "{}" });
    await toolExecutor(runner, { environ })(run);
    const folder = path.join(run.runDir, ".output");
    const stuck = path.join(folder, "stuck");
    mkdirSync(stuck);
    writeFileSync(path.join(stuck, "f"), "x");
    chmodSync(stuck, 0o000);
    const warnings: string[] = [];
    clearOutputFiles(run.runDir, line => {
      warnings.push(line);
    });
    chmodSync(stuck, 0o700);
    expect(warnings).toEqual([
      `Could not remove ${folder}, which may hold a result that was not scrubbed.`,
    ]);
  });

  it("fails the node when the program leaves a folder there", async () => {
    const run = context(json());
    let file = "";
    const { runner } = runnerOf({}, env => {
      file = outputFileOf(env);
      mkdirSync(file);
    });
    const result = await toolExecutor(runner, { environ })(run);
    expect(result.error).toBe("n: $ORK_OUTPUT is not a file");
    expect(existsSync(file)).toBe(false);
  });

  it("survives a failed program that leaves a folder there", async () => {
    const run = context(json());
    let file = "";
    const { runner } = runnerOf({ exitCode: 3 }, env => {
      file = outputFileOf(env);
      mkdirSync(file);
    });
    const result = await toolExecutor(runner, { environ })(run);
    expect(result.ok).toBe(false);
    expect(existsSync(file)).toBe(false);
  });
});

describe("variables a run needs", () => {
  it("does not count what every object inherits as set", () => {
    const node = shell({ env: { X: "{{env.constructor}}" } });
    const workflow = {
      schemaVersion: 1 as const,
      name: "wf",
      nodes: { n: node },
    };
    expect(missingEnv(workflow, {})).toEqual([
      { variable: "constructor", nodes: ["n"] },
    ]);
  });

  it("warns of what a called workflow reads, once per variable", () => {
    const place = calledPlace();
    expect(calledEnvWarning(PARENT, place, [], undefined, {})).toEqual([
      "A workflow this run may call reads variables that are not set:",
      "  CHILD_TOKEN, for child/deploy",
      "  REGION, for child/region",
      "That call fails if the run reaches it.",
    ]);
  });

  it("warns of a call whose last go failed", () => {
    const history = new Map([["call", [{ ok: true }, { ok: false }]]]);
    expect(calledEnvWarning(PARENT, calledPlace(), [], history, {})).toContain(
      "  CHILD_TOKEN, for child/deploy",
    );
  });

  it("warns of a called workflow that cannot be read, and does not throw", () => {
    const place = calledPlace();
    const file = path.join(place.dir, "workflows", "child.ork.yaml");
    writeFileSync(file, "a: &a [x, x]\nb: &b [*a, *a]\n");
    for (let round = 0; round < 40; round += 1) {
      writeFileSync(
        file,
        `${readFileSync(file, "utf8")}k${String(round)}: &k${String(round)} [*b, *b, *b, *b]\n`,
      );
    }
    expect(calledEnvWarning(PARENT, place, [], undefined, {})).toEqual([
      "Could not read child, which this run may call, so what it reads is neither checked nor masked.",
    ]);
    expect(maskedNamesOfRun(PARENT, place, [], {})).toEqual([]);
  });

  it("does not throw on a called file it has no right to read", () => {
    const place = calledPlace();
    const file = path.join(place.dir, "workflows", "child.ork.yaml");
    chmodSync(file, 0o000);
    const warning = calledEnvWarning(PARENT, place, [], undefined, {});
    chmodSync(file, 0o600);
    expect(warning).toHaveLength(1);
  });

  it("warns of a called workflow with the caller's own name", () => {
    const place = calledPlace();
    const file = path.join(place.dir, "workflows", "child.ork.yaml");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("name: child", "name: parent"),
    );
    expect(calledEnvWarning(PARENT, place, [], undefined, {})).toContain(
      "  CHILD_TOKEN, for parent/deploy",
    );
  });

  it("does not ask for a variable only a finished node read", () => {
    const node = shell({ env: { X: "{{env.GONE}}" } });
    const workflow = {
      schemaVersion: 1 as const,
      name: "wf",
      nodes: { n: node },
    };
    expect(missingEnv(workflow, {}, new Set(["n"]))).toEqual([]);
  });

  it("does not warn of a call a resumed run has finished", () => {
    const history = new Map([["call", [{ ok: true }]]]);
    expect(calledEnvWarning(PARENT, calledPlace(), [], history, {})).toEqual(
      [],
    );
  });

  it("does not warn of a call that runs one node", () => {
    const parent = {
      ...PARENT,
      nodes: {
        call: {
          type: "workflow.call" as const,
          workflow: "child",
          node: "lead",
        },
      },
    };
    expect(calledEnvWarning(parent, calledPlace(), [], undefined, {})).toEqual(
      [],
    );
  });

  it("masks what a called workflow reads, but not what plainEnv excuses", () => {
    expect(maskedNamesOfRun(PARENT, calledPlace(), [], {})).toEqual([
      "CHILD_TOKEN",
    ]);
    expect(
      maskedNamesOfRun(PARENT, calledPlace(), [], maskedEnv(["UP"])),
    ).toEqual(["CHILD_TOKEN", "UP"]);
  });
});

const itemOf = (value: unknown, index = 3) => ({
  item: { of: "n", index, value },
});

/** A runner that writes down the arguments and env of its one run. */
const argsRunner = () => {
  const seen: { args: readonly string[]; env: Record<string, string> }[] = [];
  const runner: ToolRunner = (_program, args, options) => {
    seen.push({ args, env: { ...options.env } });
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  };
  return { runner, seen };
};

describe("a tool node's item", () => {
  it("sets ORK_ITEM plainly for a string, and ORK_INDEX", async () => {
    const { runner, seen } = argsRunner();
    await toolExecutor(runner)(context(shell(), itemOf("a b")));
    expect(seen[0]?.env).toMatchObject({ ORK_ITEM: "a b", ORK_INDEX: "3" });
  });

  it.each([
    [{ title: "x", n: 1 }, '{"title":"x","n":1}'],
    [["a"], '["a"]'],
    [2, "2"],
    [false, "false"],
    [null, "null"],
  ])("sets ORK_ITEM to JSON for %j", async (value, expected) => {
    const { runner, seen } = argsRunner();
    await toolExecutor(runner)(context(shell(), itemOf(value, 0)));
    expect(seen[0]?.env).toMatchObject({ ORK_ITEM: expected, ORK_INDEX: "0" });
  });

  it("sets neither without an item", async () => {
    const { runner, seen } = argsRunner();
    await toolExecutor(runner)(context(shell()));
    expect(seen[0]?.env).not.toHaveProperty("ORK_ITEM");
    expect(seen[0]?.env).not.toHaveProperty("ORK_INDEX");
  });

  it("keeps {{item}} one argument, whatever it holds", async () => {
    const { runner, seen } = argsRunner();
    await toolExecutor(runner)(
      context(
        shell({ command: "prog --name {{item}} {{index}}" }),
        itemOf("a b; rm -rf / --flag", 1),
      ),
    );
    expect(seen[0]?.args).toEqual(["--name", "a b; rm -rf / --flag", "1"]);
  });

  it("reads the item in `env:` and `cwd`", async () => {
    const { runner, seen } = argsRunner();
    const run = context(
      shell({ env: { TITLE: "{{item.title}}" }, cwd: "." }),
      itemOf({ title: "docs" }),
    );
    await toolExecutor(runner)(run);
    expect(seen[0]?.env).toMatchObject({ TITLE: "docs" });
  });

  it("reaches a real program", async () => {
    const run = context(
      shell({ command: `sh -c 'echo "$ORK_INDEX $ORK_ITEM"'` }),
      itemOf("api", 4),
    );
    const result = await toolExecutor(spawnTool)(run);
    expect(result.output["stdout"]).toBe("4 api\n");
  });

  it("is not passed on to a run its program starts", () => {
    expect(
      withoutIdentity({ ORK_ITEM: "x", ORK_INDEX: "1", KEEP: "1" }),
    ).toEqual({ KEEP: "1" });
  });
});
