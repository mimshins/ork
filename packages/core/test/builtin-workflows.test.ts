/**
 * @file Tests for Ork's built-in workflows: each is canonical and checks clean,
 *   an `ork:` name is written into the project's run folder under its text's
 *   hash (and written again if someone changed it), an unknown one is named as
 *   such, `ork:feedback-apply` asks to keep a fix only when one was made, and
 *   `ork:onboard-write` loops its checker back to the writer for at most three
 *   rounds before its gate.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  builtinWorkflowFile,
  builtinWorkflowNames,
  checkWorkflowText,
  type HumanChannel,
  inRepoPlace,
  type NodeExecutor,
  type NodeOutput,
  startRun,
  unknownBuiltin,
} from "../src/index.ts";
import { BUILTIN_WORKFLOWS } from "../src/project/builtin-workflows.ts";

/** A project with a git folder, in a fresh temporary folder. */
const project = () => {
  const root = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-builtin-"))),
    "app",
  );
  mkdirSync(path.join(root, ".git"), { recursive: true });
  return inRepoPlace(root);
};

/** The built-in `name`'s file in a new project, failing when there is none. */
const fileOf = (name: string) => {
  const place = project();
  const file = builtinWorkflowFile(place, name);
  if (file === undefined) throw new Error(`No built-in ${name}.`);
  return { place, file };
};

const BUILTINS = Object.entries(BUILTIN_WORKFLOWS);

/** A workflow's text as Ork's serializer writes it. */
const canonical = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return serializeWorkflow(parsed.workflow);
};

describe("the built-in workflows", () => {
  it("has some, each named with `ork:`", () => {
    expect(builtinWorkflowNames()).toEqual([
      "ork:feedback-apply",
      "ork:onboard-propose",
      "ork:onboard-write",
      "ork:security-audit",
    ]);
  });

  it.each(BUILTINS)("%s is canonical", (_name, text) => {
    expect(canonical(text)).toBe(text);
  });

  it.each(BUILTINS)("%s checks with no error or warning", name => {
    // As written, beside its companion files, which its `context:` refs name.
    const { place, file } = fileOf(`ork:${name}`);
    const { diagnostics } = checkWorkflowText(readFileSync(file, "utf8"), {
      place,
      workflowDir: path.dirname(file),
      registered: [],
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("an `ork:` name", () => {
  it("is written into the project's run folder, under its text's hash", () => {
    const { place, file } = fileOf("ork:feedback-apply");
    expect(path.relative(place.root, file)).toMatch(
      /^\.ork\/runs\/\.builtin\/[0-9a-f]{12}\/feedback-apply\.ork\.yaml$/u,
    );
    expect(readFileSync(file, "utf8")).toBe(
      BUILTIN_WORKFLOWS["feedback-apply"],
    );
  });

  it("gives the same file each time, and writes it again if it changed", () => {
    const { place, file } = fileOf("ork:feedback-apply");
    writeFileSync(file, "changed by hand\n");
    expect(builtinWorkflowFile(place, "ork:feedback-apply")).toBe(file);
    expect(readFileSync(file, "utf8")).toBe(
      BUILTIN_WORKFLOWS["feedback-apply"],
    );
  });

  it("that names no built-in is refused, naming those there are", () => {
    expect(builtinWorkflowFile(project(), "ork:nope")).toBeUndefined();
    expect(unknownBuiltin("ork:nope")).toBe(
      "`ork:nope` isn't one of Ork's workflows: `ork:feedback-apply`, `ork:onboard-propose`, `ork:onboard-write`, `ork:security-audit`",
    );
    expect(unknownBuiltin("ork:feedback-apply")).toBeUndefined();
    expect(unknownBuiltin("hello")).toBeUndefined();
  });
});

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "keep"),
  permit: () => Promise.resolve({ allow: true }),
};

/** Runs `ork:feedback-apply` with `fix` reporting `fix`; returns what ran. */
const apply = async (fix: NodeOutput, choice = "keep") => {
  const { place, file } = fileOf("ork:feedback-apply");
  const { graph } = checkWorkflowText(readFileSync(file, "utf8"), {
    place,
    workflowDir: place.dir,
    registered: [],
  });
  if (graph === null) throw new Error("The built-in doesn't compile.");
  const ran: string[] = [];
  const outputs: Record<string, NodeOutput> = {
    fix,
    changes: { exitCode: 0, stdout: " AGENTS.md | 1 +", stderr: "" },
    keep: { choice, answeredBy: "terminal" },
  };
  const executor: NodeExecutor = ({ id }) => {
    ran.push(id);
    const output = outputs[id] ?? {};
    return Promise.resolve({ ok: output["status"] !== "fail", output });
  };
  const { done } = startRun({
    graph,
    inputs: { item: "ab12", about: "AGENTS.md has no test command." },
    cwd: place.root,
    executors: {
      "agent.worker": executor,
      "tool.git": executor,
      "human.gate": executor,
    },
    human,
    onEvent: () => {
      // What ran is enough here.
    },
  });
  return { result: await done, ran };
};

describe("ork:feedback-apply", () => {
  it("asks whether to keep a fix the worker made", async () => {
    const { result, ran } = await apply({
      status: "done",
      summary: "Added the test command to AGENTS.md.",
      branch: "ork/r1/fix",
    });
    expect(ran).toEqual(["fix", "changes", "keep"]);
    expect(result.status).toBe("succeeded");
  });

  it("asks nothing when the worker found nothing to change", async () => {
    const { result, ran } = await apply({
      status: "fail",
      summary: "Nothing here causes it.",
    });
    expect(ran).toEqual(["fix"]);
    expect(result.status).toBe("failed");
  });
});

/** A node's result in a scripted run: the `n`th time it runs (from 1). */
type Script = (id: string, n: number) => { ok: boolean; output: NodeOutput };

/** Runs the built-in `name` with each node's result from `script`. */
const runBuiltin = async (
  name: string,
  inputs: Record<string, string>,
  script: Script,
) => {
  const { place, file } = fileOf(name);
  const { graph } = checkWorkflowText(readFileSync(file, "utf8"), {
    place,
    workflowDir: path.dirname(file),
    registered: [],
  });
  if (graph === null) throw new Error("The built-in doesn't compile.");
  const ran: string[] = [];
  const executor: NodeExecutor = ({ id }) => {
    ran.push(id);
    return Promise.resolve(script(id, ran.filter(r => r === id).length));
  };
  const { done } = startRun({
    graph,
    inputs,
    cwd: place.root,
    executors: {
      "agent.worker": executor,
      "tool.shell": executor,
      "tool.git": executor,
      "human.gate": executor,
    },
    human,
    onEvent: () => {
      // What ran is enough here.
    },
  });
  return { result: await done, ran };
};

const WRITE_INPUTS = { picks: "[]", survey: "pnpm", answers: "Q: a\nA: b" };

/** `ork:onboard-write`'s nodes, with `finish` failing its first `fails` runs. */
const writeScript =
  (fails: number): Script =>
  (id, n) => {
    const outputs: Record<string, NodeOutput> = {
      format: { exitCode: 0, stdout: "schemaVersion*: 1", stderr: "" },
      write: { status: "done", summary: "Wrote ci.", branch: "ork/r1/write" },
      finish: {
        exitCode: n > fails ? 0 : 1,
        stdout: "problems:\n- none",
        stderr: "",
      },
      changes: {
        exitCode: 0,
        stdout: " .ork/workflows/ci.ork.yaml",
        stderr: "",
      },
      keep: { choice: "keep", answeredBy: "terminal" },
    };
    return {
      ok: id !== "finish" || n > fails,
      output: outputs[id] ?? {},
    };
  };

describe("ork:onboard-write", () => {
  it("writes, checks, shows the change and asks whether to keep it", async () => {
    const { result, ran } = await runBuiltin(
      "ork:onboard-write",
      WRITE_INPUTS,
      writeScript(0),
    );
    expect(ran).toEqual(["format", "write", "finish", "changes", "keep"]);
    expect(result.status).toBe("succeeded");
  });

  it("sends finish's problems back to the writer until they pass", async () => {
    const { result, ran } = await runBuiltin(
      "ork:onboard-write",
      WRITE_INPUTS,
      writeScript(2),
    );
    expect(ran).toEqual([
      "format",
      "write",
      "finish",
      "write",
      "finish",
      "write",
      "finish",
      "changes",
      "keep",
    ]);
    expect(result.status).toBe("succeeded");
  });

  it("ends failed, never at the gate, when the rounds run out", async () => {
    const { result, ran } = await runBuiltin(
      "ork:onboard-write",
      WRITE_INPUTS,
      writeScript(Number.POSITIVE_INFINITY),
    );
    expect(ran.filter(id => id === "write")).toHaveLength(4);
    expect(ran).not.toContain("keep");
    expect(result.status).toBe("failed");
  });
});

/** `ork:onboard-propose`'s one node: a proposal. */
const proposeScript: Script = () => ({
  ok: true,
  output: { status: "done", summary: "One.", suggestions: [] },
});

describe("ork:onboard-propose", () => {
  it("proposes, and nothing else", async () => {
    const { result, ran } = await runBuiltin(
      "ork:onboard-propose",
      { survey: "pnpm", answers: "Q: a\nA: b" },
      proposeScript,
    );
    expect(ran).toEqual(["propose"]);
    expect(result.status).toBe("succeeded");
  });
});
