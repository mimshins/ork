/**
 * @file Tests the shared recogniser of a guard's refusal (`refusal.ts`), which
 *   the Command Code and `omp` decoders mark `fault: "refused"` by: it takes
 *   the real refusals Command Code's mod and the `omp` guard give (so a change
 *   of their words breaks it) and nothing else they say. The decoders' marks
 *   are tested in `tool-fault.test.ts` and `codex.test.ts`.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { modSource } from "../src/adapters/command-code-mod.ts";
import { guardSource, OMP_PAUSED } from "../src/adapters/omp-guard.ts";
import { isGuardRefusal } from "../src/tools/refusal.ts";
import type { ToolRuleSet } from "../src/tools/tool-rules-source.ts";

type Hook = (call: unknown) => Promise<unknown>;

const HookSchema = z.custom<Hook>(value => typeof value === "function");
const ModuleSchema = z.object({
  default: z.custom<(api: unknown) => void>(
    value => typeof value === "function",
  ),
});

const tmp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-refused-${name}-`));

/** A node with no rule that reads only through `extract`. */
const rules = (): ToolRuleSet => ({
  cwd: tmp("work"),
  allow: [],
  deny: [],
  refuseReads: true,
  refuseTextReads: true,
});

/** Writes `source` as a module and loads it, giving its default export. */
const load = async (source: string) => {
  const file = path.join(tmp("module"), "guard.mjs");
  writeFileSync(file, source);
  return ModuleSchema.parse(await import(pathToFileURL(file).href)).default;
};

/** What Command Code's mod answers a call with: the blocked frame's text. */
const commandCodeSays = async (
  calls: readonly [string, Record<string, unknown>][],
): Promise<string[]> => {
  const hooks = new Map<string, unknown>();
  (await load(modSource(rules())))({
    hooks: (given: Record<string, unknown>) => {
      for (const [key, hook] of Object.entries(given)) hooks.set(key, hook);
    },
  });
  const before = HookSchema.parse(hooks.get("beforeToolCall"));
  const answers = await Promise.all(
    calls.map(([toolName, input]) => before({ toolName, input })),
  );
  return answers.map(
    answer =>
      z.object({ additionalContext: z.string() }).parse(answer)
        .additionalContext,
  );
};

/** What the `omp` guard answers a call with: the refused call's text. */
const ompSays = async (
  calls: readonly [string, Record<string, unknown>][],
): Promise<string[]> => {
  const handlers = new Map<string, unknown>();
  (await load(guardSource(rules(), { dir: tmp("secret"), hold: false })))({
    on: (type: string, handler: unknown) => handlers.set(type, handler),
  });
  const call = HookSchema.parse(handlers.get("tool_call"));
  const answers = await Promise.all(
    calls.map(([toolName, input], at) =>
      call({
        type: "tool_call",
        toolName,
        toolCallId: `c${String(at)}`,
        input,
      }),
    ),
  );
  return answers.map(
    answer => z.object({ reason: z.string() }).parse(answer).reason,
  );
};

/** Which of `texts` the recogniser takes for a refusal. */
const recognised = (texts: readonly string[]): boolean[] =>
  texts.map(text => isGuardRefusal(text));

describe("the guard's refusal", () => {
  it("is recognised in each refusal Command Code's mod gives", async () => {
    const said = await commandCodeSays([
      ["shell", { command: "rm -rf x" }],
      ["shell", { command: "cat a.ts" }],
      ["read_file", { path: "a.ts" }],
      ["web_search", { query: "x" }],
    ]);
    expect(recognised(said)).toEqual([true, true, true, true]);
  });

  it("is recognised in each refusal the omp guard gives", async () => {
    const said = await ompSays([
      ["bash", { command: "rm -rf x" }],
      ["bash", { command: "cat a.ts" }],
      ["read", { path: "a.ts" }],
      ["write", { path: "/etc/x", content: "" }],
      ["eval", {}],
    ]);
    expect(recognised(said)).toEqual([true, true, true, true, true]);
  });

  it("is not a pause, a stop, a guard that could not ask or check, or a tool's error", () => {
    expect(
      recognised([
        OMP_PAUSED,
        "Ork stopped this node, so this call did not run. Do nothing else.",
        "Ork: bash did not run, Ork could not be asked (status 500).",
        "Ork: the call is refused, its rules could not be checked (boom).",
        "Blocked by a pre-tool hook.",
        "Error: exit 1",
        "bash: exit 1\nOrk: shell is not allowed for this node. Do not retry it.",
      ]),
    ).toEqual([false, false, false, false, false, false, false]);
  });
});
