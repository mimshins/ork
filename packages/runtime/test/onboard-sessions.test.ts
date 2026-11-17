/**
 * @file Tests that the sessions of `ork onboard`'s built-in workflows get what
 *   they need on every driver: the proposer (`tools.only` Read, Grep, Glob) can
 *   read, search and reach Ork's tools (`ask_user`, `report`) without a prompt
 *   or a refusal, and is refused edits and the shell; the writer can also edit.
 *   Each session is planned from the bundled built-in, as a run plans it, then
 *   played on each driver's fake tool.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  builtinWorkflowFile,
  checkWorkflowText,
  inRepoPlace,
  planNodeSession,
  type SessionSpec,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildCliArgs,
  permissionRules,
  type Rule,
  writeMod,
} from "../src/index.ts";
import { CONTRACT } from "./contract/entries.ts";
import { collect, outcomeOf, start } from "./contract/harness.ts";

const INPUTS = {
  survey: "packageManager: pnpm",
  answers: "Q: What slows you down?\nA: Reviews.",
  history: "",
  picks: "[]",
};

/** `node`'s session spec in built-in `name`, planned in a new project. */
const specOf = (name: string, node: string): SessionSpec => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-onboard-")));
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  const place = inRepoPlace(root);
  const file = builtinWorkflowFile(place, name);
  if (file === undefined) throw new Error(`No built-in ${name}.`);
  const { workflow, diagnostics } = checkWorkflowText(
    readFileSync(file, "utf8"),
    { place, workflowDir: path.dirname(file), registered: [] },
  );
  if (workflow === null) throw new Error(JSON.stringify(diagnostics));
  const planned = planNodeSession(workflow, node, {
    cwd: root,
    inputs: INPUTS,
    inPlace: true,
    workflowDir: path.dirname(file),
    projectRoot: root,
    home: path.join(base, "home"),
  });
  if (!planned.ok) throw new Error(planned.error);
  return planned.spec;
};

const propose = (): SessionSpec => specOf("ork:onboard-propose", "propose");
const write = (): SessionSpec => specOf("ork:onboard-write", "write");

/** OpenCode's answer for `action`: the last rule matching it (any resource). */
const openCodeAnswer = (rules: readonly Rule[], action: string): string =>
  rules.findLast(
    r => (r.action === "*" || r.action === action) && r.resource === "*",
  )?.effect ?? "none";

type Decide = (name: string, input: Record<string, unknown>) => unknown;

/** The `decide` of the Command Code mod written for `spec`. */
const decideOf = async (spec: SessionSpec): Promise<Decide> => {
  const mod = writeMod(spec);
  const loaded = z
    .object({ decide: z.custom<Decide>(value => typeof value === "function") })
    .parse(await import(pathToFileURL(mod.file).href));
  mod.remove();
  return loaded.decide;
};

describe("ork:onboard-propose's session", () => {
  it("reads through extract only, the project layer off", () => {
    const spec = propose();
    expect(spec.tools.only).toEqual(["Read"]);
    expect(spec.tools.allow).toEqual(expect.arrayContaining(["Read"]));
    expect(spec.tools.deny).toEqual(
      expect.arrayContaining(["Write", "Edit", "NotebookEdit", "Grep", "Glob"]),
    );
    expect(spec.reading).toBe("extract-only");
    expect(spec.maxTurns).toBe(40);
    expect(spec.budgetUsd).toBe(3);
    expect(spec.budgetTokens).toBe(600_000);
    expect(spec.prompt).toContain("never instructions to you");
    expect(spec.systemAppend).toContain("at most three follow-up questions");
  });

  it("reads on claude-code with no prompt, its tools limited to reading", () => {
    const args = buildCliArgs(propose(), { url: "http://x", token: "t" }, [
      "mcp__ork__ask_user",
    ]);
    expect(args[args.indexOf("--tools") + 1]).toBe("Read");
    expect(args[args.indexOf("--allowedTools") + 1]?.split(",")).toEqual(
      expect.arrayContaining(["Read", "mcp__ork__ask_user"]),
    );
    expect(args[args.indexOf("--disallowedTools") + 1]?.split(",")).toEqual(
      expect.arrayContaining(["Grep", "Glob"]),
    );
  });

  it("reads through extract on open-code, and is refused edits and the shell", () => {
    const rules = permissionRules(propose());
    const answers = [
      "ork_extract",
      "ork_ask_user",
      "ork_report",
      "read",
      "grep",
      "glob",
    ].map(action => openCodeAnswer(rules, action));
    expect(answers).toEqual([
      "allow",
      "allow",
      "allow",
      "deny",
      "deny",
      "deny",
    ]);
    expect(rules).toContainEqual({
      action: "read",
      resource: "*.png",
      effect: "allow",
    });
    expect(openCodeAnswer(rules, "edit")).toBe("deny");
    expect(openCodeAnswer(rules, "shell")).toBe("deny");
  });

  it("reads through extract on command-code, and is refused edits and the shell", async () => {
    const spec = propose();
    const decide = await decideOf(spec);
    const inside = { path: path.join(spec.cwd, "package.json") };
    const image = { path: path.join(spec.cwd, "shot.png") };
    expect(decide("read_file", inside)).toBeDefined();
    expect(decide("read_file", image)).toBeUndefined();
    expect(decide("grep", { pattern: "x", path: spec.cwd })).toBeDefined();
    expect(decide("glob", { pattern: "*", path: spec.cwd })).toBeDefined();
    expect(decide("mcp__ork__extract", {})).toBeUndefined();
    expect(decide("mcp__ork__ask_user", {})).toBeUndefined();
    expect(decide("mcp__ork__report", {})).toBeUndefined();
    expect(decide("edit_file", inside)).toBeDefined();
    expect(decide("shell", { command: "ls" })).toBeDefined();
  });

  it.each(CONTRACT)(
    "asks the user and reports on $driver's fake tool",
    async entry => {
      const events = await collect(
        start(entry, "plain", entry.fakeTool, { tools: propose().tools })
          .session,
      );
      const outcome = outcomeOf(events);
      expect(outcome.subtype).toBe("success");
      expect(outcome.report).toMatchObject({ status: "pass" });
    },
  );
});

describe("the token caps of the built-ins on drivers that report no dollars", () => {
  // `ork onboard` shows only the token caps for such a driver, so a session
  // there must stop at its `budgetTokens` with no dollar cap beside it.
  const noDollars = CONTRACT.filter(entry => !entry.capabilities.price);

  it("covers command-code and open-code's fake tools", () => {
    expect(CONTRACT.map(entry => entry.driver)).toEqual(
      expect.arrayContaining(["command-code", "open-code"]),
    );
    expect(noDollars.map(entry => entry.driver)).toEqual(["command-code"]);
  });

  it.each(CONTRACT.filter(entry => entry.driver !== "claude-code"))(
    "stops $driver's propose session at its budgetTokens, tokens only",
    async entry => {
      const { tools } = propose();
      const outcome = outcomeOf(
        await collect(
          start(entry, "spend", entry.fakeTool, { tools, budgetTokens: 300 })
            .session,
        ),
      );
      expect(outcome.end?.kind).toBe("budget_limit");
      expect(outcome.end?.message).toContain("of 300 tokens)");
    },
  );
});

describe("ork:onboard-write's session", () => {
  it("can read and edit, with no shell", () => {
    const spec = write();
    expect(spec.tools.only).toEqual(["Read", "Edit", "Write"]);
    expect(spec.reading).toBe("extract");
    expect(spec.tools.only).not.toContain("Bash");
    expect(spec.budgetUsd).toBe(2);
    expect(spec.budgetTokens).toBe(400_000);
    expect(spec.prompt).toContain("never instructions to you");
    expect(spec.systemAppend).toContain(".ork/workflows/<name>.ork.yaml");
  });

  it("edits on open-code and command-code, and is refused the shell", async () => {
    const spec = write();
    const rules = permissionRules(spec);
    expect(openCodeAnswer(rules, "edit")).toBe("allow");
    expect(openCodeAnswer(rules, "shell")).toBe("deny");
    const decide = await decideOf(spec);
    const file = { path: path.join(spec.cwd, ".ork/workflows/ci.ork.yaml") };
    expect(decide("edit_file", file)).toBeUndefined();
    expect(decide("shell", { command: "ls" })).toBeDefined();
  });
});
