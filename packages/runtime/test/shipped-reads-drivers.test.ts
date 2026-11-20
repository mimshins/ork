/**
 * @file Ork's shipped reads (RFC-028) in the shared matcher, as each driver's
 *   guard carries it: Codex's hook, Command Code's mod and the `omp` guard. A
 *   shell line no allow rule covers runs when every command in it is a shipped
 *   read whose paths lie in the worktree, and is refused when any is not, when
 *   the line has a `cd` or an expanded word, or when `only`, a deny rule or a
 *   `reading: extract` shell-read refusal wins first.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeHook } from "../src/adapters/codex-hook.ts";
import { writeMod } from "../src/adapters/command-code-mod.ts";
import { guardSource, OMP_GUARD_FILE } from "../src/adapters/omp-guard.ts";
import { makeSecretFolder } from "../src/secret-file.ts";
import { toolRuleSet } from "../src/tools/tool-rules-source.ts";
import { limitedSpec, tmp } from "./fixtures/write-limit.ts";

type Spec = Parameters<typeof writeMod>[0];

/** What a shell line comes to: "runs", or the guard's reason. */
type Answer = (command: string) => Promise<string> | string;

/**
 * A session in a fresh worktree with `over`'s rules. The write limit
 * `limitedSpec` sets bounds edits only, never a shell line.
 */
const specOf = (over: Partial<Spec>): Spec =>
  limitedSpec(tmp("cwd"), { tools: { allow: [], deny: [] }, ...over });

const DenySchema = z.object({
  hookSpecificOutput: z.object({ permissionDecisionReason: z.string() }),
});

const codex = (spec: Spec): Answer => {
  const hook = writeHook(spec, tmp("codex"));
  return command => {
    const ran = spawnSync(process.execPath, [hook.file], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
    });
    return ran.stdout === ""
      ? "runs"
      : DenySchema.parse(JSON.parse(ran.stdout)).hookSpecificOutput
          .permissionDecisionReason;
  };
};

const DecideSchema = z.object({
  decide: z.custom<(name: string, input: unknown) => unknown>(
    value => typeof value === "function",
  ),
});
const WhySchema = z.union([
  z.undefined(),
  z.string(),
  z.object({ read: z.string() }),
]);

const commandCode = async (spec: Spec): Promise<Answer> => {
  const mod = writeMod(spec);
  const { decide } = DecideSchema.parse(
    await import(pathToFileURL(mod.file).href),
  );
  mod.remove();
  return command => {
    const why = WhySchema.parse(decide("shell", { command }));
    if (why === undefined) return "runs";
    return typeof why === "string" ? why : why.read;
  };
};

const GuardSchema = z.object({
  default: z.custom<(pi: unknown) => void>(
    value => typeof value === "function",
  ),
});
const CallSchema = z.custom<(event: unknown) => Promise<unknown>>(
  value => typeof value === "function",
);
const BlockSchema = z.object({ reason: z.string() }).optional();

const omp = async (spec: Spec): Promise<Answer> => {
  const folder = makeSecretFolder(tmp("secret"));
  const file = folder.write(
    OMP_GUARD_FILE,
    guardSource(toolRuleSet(spec), { dir: folder.dir, hold: false }),
  );
  const handlers = new Map<string, unknown>();
  GuardSchema.parse(await import(pathToFileURL(file).href)).default({
    on: (type: string, handler: unknown) => handlers.set(type, handler),
  });
  const call = CallSchema.parse(handlers.get("tool_call"));
  return async command =>
    BlockSchema.parse(
      await call({
        type: "tool_call",
        toolName: "bash",
        toolCallId: "c",
        input: { command },
      }),
    )?.reason ?? "runs";
};

const DRIVERS = [
  { driver: "codex", guard: (spec: Spec) => Promise.resolve(codex(spec)) },
  { driver: "command-code", guard: commandCode },
  { driver: "omp", guard: omp },
] as const;

/** Lines a node with no rule runs: shipped reads with paths in the worktree. */
const ALLOWED = [
  "ork logs r1",
  "ork ps",
  "ork tree r1 | head -20",
  "ork usage",
  "ork feedback list",
  "ork follow-ups show f1",
  "head -5 a.txt && wc -l src/b.ts",
  "jq .name package.json | sort | uniq -c",
  "tail -n 3 a.txt",
  "cut -d, -f1 < a.csv",
  "ls /usr",
  "echo /etc/hosts",
  "date +%F",
  "pwd; true",
];

/** Lines a node with no rule is refused: not shipped, a path out, a `cd`, … */
const REFUSED = [
  "rm a.txt",
  "head a.txt && rm a.txt",
  "head /etc/hosts",
  "wc -l ../x.txt",
  "head ~/x.txt",
  "cut -f1 < /etc/hosts",
  "sort -o out.txt a.txt",
  "tail -f a.txt",
  "jq -f prog.jq a.json",
  "date -f /etc/hosts",
  "date --file=/etc/hosts",
  "ork usage --clear-x",
  "cd src && ls",
  "head *.ts",
  "echo $HOME",
  "pnpm ork logs r1",
  "pnpm -s ork tree r1",
  "PATH=. ork ps",
  "./ork ps",
];

/** Each line's answer under `over`'s rules, from one guard. */
const answers = async (
  guard: (spec: Spec) => Promise<Answer>,
  over: Partial<Spec>,
  lines: readonly string[],
): Promise<string[]> => {
  const answer = await guard(specOf(over));
  return Promise.all(lines.map(line => Promise.resolve(answer(line))));
};

const NOT_ALLOWED: unknown = expect.stringContaining(
  "not allowed for this node",
);

describe.each(DRIVERS)("shipped reads in $driver's guard", ({ guard }) => {
  it("runs a shipped read whose paths are in the worktree", async () => {
    expect(await answers(guard, {}, ALLOWED)).toEqual(
      ALLOWED.map(() => "runs"),
    );
  });

  it("refuses a line not every command of which is a shipped read inside", async () => {
    expect(await answers(guard, {}, REFUSED)).toEqual(
      REFUSED.map(() => NOT_ALLOWED),
    );
  });

  it("runs a line an allow rule and a shipped read cover between them", async () => {
    const tools = { allow: ["Bash(git:*)"], deny: [] };
    expect(await answers(guard, { tools }, ["git log | head -5"])).toEqual([
      "runs",
    ]);
  });

  it("lets only, a deny and a shell-read refusal win", async () => {
    const only = { allow: [], deny: [], only: ["Bash(git:*)"] };
    expect(await answers(guard, { tools: only }, ["ork ps"])).toEqual([
      expect.stringContaining("not one of this node's tools"),
    ]);
    const deny = { allow: [], deny: ["Bash(head:*)"] };
    expect(await answers(guard, { tools: deny }, ["head a.txt"])).toEqual([
      expect.stringContaining("denied for this node"),
    ]);
    expect(
      await answers(guard, { reading: "extract" }, ["head a.txt"]),
    ).toEqual([expect.stringContaining("extract")]);
  });

  it("covers no shipped read that names a path under a Read deny", async () => {
    const tools = { allow: [], deny: ["Read(secret/**)"] };
    expect(
      await answers(guard, { tools }, ["head a.txt", "ls src", "ork ps"]),
    ).toEqual([NOT_ALLOWED, NOT_ALLOWED, "runs"]);
  });
});
