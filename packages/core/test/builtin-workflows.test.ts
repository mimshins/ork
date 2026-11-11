/**
 * @file Tests for Ork's built-in workflows: each is canonical and checks clean,
 *   an `ork:` name is written into the project's run folder under its text's
 *   hash (and written again if someone changed it), an unknown one is named as
 *   such, and `ork:feedback-apply` asks to keep a fix only when one was made.
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
    expect(builtinWorkflowNames()).toContain("ork:feedback-apply");
  });

  it.each(BUILTINS)("%s is canonical", (_name, text) => {
    expect(canonical(text)).toBe(text);
  });

  it.each(BUILTINS)("%s checks with no error or warning", (_name, text) => {
    const place = project();
    const { diagnostics } = checkWorkflowText(text, {
      place,
      workflowDir: place.dir,
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
      "`ork:nope` isn't one of Ork's workflows: `ork:feedback-apply`",
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
