/**
 * @file The write limit (`SessionSpec.writeOnly`) in the shared matcher, as
 *   each driver carries it with its own edit tool's paths: Codex's hook (a
 *   patch's file headers), Command Code's mod (path keys) and the `omp` guard
 *   (a write's path, an edit's header lines).
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeHook } from "../src/adapters/codex-hook.ts";
import { writeMod } from "../src/adapters/command-code-mod.ts";
import { guardSource, OMP_GUARD_FILE } from "../src/adapters/omp-guard.ts";
import { makeSecretFolder } from "../src/secret-file.ts";
import {
  checkout,
  LIMIT,
  LIMITED,
  limitedSpec,
  tmp,
} from "./fixtures/write-limit.ts";

const DenySchema = z.object({
  hookSpecificOutput: z.object({ permissionDecisionReason: z.string() }),
});

/** Codex's hook's answer to a patch; "runs" when it allows it. */
const codexAnswer = (cwd: string, patch: string): string => {
  const hook = writeHook(limitedSpec(cwd), tmp("codex"));
  const ran = spawnSync(process.execPath, [hook.file], {
    input: JSON.stringify({
      tool_name: "apply_patch",
      tool_input: { command: `*** Begin Patch\n${patch}\n*** End Patch` },
    }),
    encoding: "utf8",
  });
  hook.remove();
  return ran.stdout === ""
    ? "runs"
    : DenySchema.parse(JSON.parse(ran.stdout)).hookSpecificOutput
        .permissionDecisionReason;
};

describe("the write limit in Codex's hook", () => {
  it("reads a patch's files: under .ork/ it runs, elsewhere or by a link it is refused", () => {
    const cwd = checkout();
    expect(
      codexAnswer(
        cwd,
        "*** Add File: .ork/a.md\n+hi\n*** Update File: .ork/b.md",
      ),
    ).toBe("runs");
    expect(
      [
        "*** Add File: src/a.ts\n+hi",
        "*** Update File: .ork/a.md\n*** Move to: src/a.md",
        "*** Delete File: .ork/AGENTS.md",
        "*** Add File: .ork/out/a.ts\n+hi",
        "+no header",
      ].map(patch => codexAnswer(cwd, patch).includes(LIMITED)),
    ).toEqual([true, true, true, true, true]);
  });
});

type Decide = (name: string, input: Record<string, unknown>) => unknown;

const DecideSchema = z.object({
  decide: z.custom<Decide>(value => typeof value === "function"),
});

describe("the write limit in Command Code's mod", () => {
  it("refuses a write_file or edit_file outside .ork/, even in yolo", async () => {
    const mod = writeMod(limitedSpec(checkout(), { yolo: true }));
    const { decide } = DecideSchema.parse(
      await import(pathToFileURL(mod.file).href),
    );
    mod.remove();
    expect(decide("write_file", { file_path: ".ork/a.md" })).toBeUndefined();
    expect(
      [
        decide("write_file", { file_path: "src/a.ts" }),
        decide("edit_file", { path: ".ork/CLAUDE.md" }),
        decide("edit_file", { content: "no path" }),
      ].map(why => String(why).includes(LIMITED)),
    ).toEqual([true, true, true]);
  });
});

const GuardSchema = z.object({
  default: z.custom<(pi: unknown) => void>(
    value => typeof value === "function",
  ),
});
const CallSchema = z.custom<(event: unknown) => Promise<unknown>>(
  value => typeof value === "function",
);
const BlockSchema = z.object({ reason: z.string() }).optional();

/** An `omp` guard limited to `.ork/`: what a call comes to, "runs" or why. */
const ompGuard = async () => {
  const cwd = checkout();
  const folder = makeSecretFolder(tmp("secret"));
  const source = guardSource(
    { cwd, allow: ["Edit", "Write"], deny: [], writeOnly: LIMIT },
    { dir: folder.dir, hold: false },
  );
  const file = folder.write(OMP_GUARD_FILE, source);
  const handlers = new Map<string, unknown>();
  GuardSchema.parse(await import(pathToFileURL(file).href)).default({
    on: (type: string, handler: unknown) => handlers.set(type, handler),
  });
  const call = CallSchema.parse(handlers.get("tool_call"));
  return async (toolName: string, input: unknown): Promise<string> =>
    BlockSchema.parse(
      await call({ type: "tool_call", toolName, toolCallId: "c", input }),
    )?.reason ?? "runs";
};

describe("the write limit in the omp guard", () => {
  it("refuses a write or an edit outside .ork/", async () => {
    const outcome = await ompGuard();
    expect(
      await Promise.all([
        outcome("write", { path: ".ork/a.md", content: "x" }),
        outcome("edit", { input: "[.ork/a.md#1]\nx" }),
      ]),
    ).toEqual(["runs", "runs"]);
    const refused = await Promise.all([
      outcome("write", { path: "src/a.ts", content: "x" }),
      outcome("edit", { input: "[src/a.ts#1]\nx" }),
      outcome("write", { path: ".ork/AGENTS.md", content: "x" }),
    ]);
    expect(refused.map(each => each.includes(LIMITED))).toEqual([
      true,
      true,
      true,
    ]);
  });
});
