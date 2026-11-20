/**
 * @file The shared matcher (`tools/tool-rules-source.ts`) with core's shell
 *   reader embedded (RFC-028): each driver's generated guard (Command Code's
 *   mod, Codex's rules module, omp's guard) checks the commands inside a loop
 *   one by one, and the generated source refuses every line the reader leaves
 *   unread to a scoped rule, while a plain `Bash` rule still allows it.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readShellLine, type SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeHook } from "../src/adapters/codex-hook.ts";
import { writeMod } from "../src/adapters/command-code-mod.ts";
import { guardSource } from "../src/adapters/omp-guard.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const specOf = (tools: SessionSpec["tools"]): SessionSpec => ({
  nodeId: "guard",
  cwd: temp("ork-guard-cwd-"),
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools,
  permissionMode: "default",
  reportSchema: { type: "object" },
  reading: "open",
});

type Decide = (name: string, input: Record<string, unknown>) => unknown;

const ModuleSchema = z.object({
  decide: z.custom<Decide>(value => typeof value === "function"),
});

const load = async (file: string): Promise<Decide> =>
  ModuleSchema.parse(await import(pathToFileURL(file).href)).decide;

/** A driver's guard for `tools`, as a `decide` on a shell line. */
type Guard = (
  tools: SessionSpec["tools"],
) => Promise<(line: string) => unknown>;

const commandCode: Guard = async tools => {
  const mod = writeMod(specOf(tools));
  const decide = await load(mod.file);
  mod.remove();
  return line => decide("shell", { command: line });
};

const codex: Guard = async tools => {
  const hook = writeHook(specOf(tools), temp("ork-guard-codex-"));
  const decide = await load(path.join(path.dirname(hook.file), "rules.mjs"));
  hook.remove();
  return line => decide("Bash", { command: line });
};

const omp: Guard = async tools => {
  const dir = temp("ork-guard-omp-");
  const file = path.join(dir, "guard.mjs");
  writeFileSync(
    file,
    guardSource({ cwd: specOf(tools).cwd, ...tools }, { dir, hold: false }),
  );
  const decide = await load(file);
  return line => decide("bash", { command: line });
};

const LOOP_RULES = { allow: ["Bash(ork logs:*)", "Bash(jq:*)"], deny: [] };

describe.each([
  ["command-code", commandCode],
  ["codex", codex],
  ["omp", omp],
])("the %s guard's loops", (_driver, guard) => {
  it("allows a loop whose every command its rules cover", async () => {
    const decide = await guard(LOOP_RULES);
    expect(
      decide("for r in a b; do ork logs $r --json | jq -r .x; done"),
    ).toBeUndefined();
  });

  it("refuses a loop holding a command its rules do not cover", async () => {
    const decide = await guard(LOOP_RULES);
    expect(decide("for r in a b; do ork logs $r; rm -rf $r; done")).toBe(
      "not allowed for this node",
    );
  });

  it("denies a loop holding a denied command, under a plain Bash rule", async () => {
    const decide = await guard({ allow: ["Bash"], deny: ["Bash(rm:*)"] });
    expect(decide("for f in a b; do rm $f; done")).toBe("denied for this node");
  });
});

/** Lines core's reader must leave unread (its own table, in part). */
const UNREAD = [
  "echo x > out.txt",
  "echo x >> out",
  "ls 2>err.log",
  "ls >| f",
  "ls &> f",
  "ls >&out",
  "ls > $F",
  "ls <> f",
  "wc < $F",
  "ls $(pwd)",
  `ls "$(pwd)"`,
  "ls `pwd`",
  'echo "`id`"',
  "echo $((1+2))",
  "echo ${x:-y}",
  "diff <(ls) <(ls)",
  "ls >(cat)",
  "eval ls",
  "timeout 5 eval ls",
  "cat <<EOF\nx\nEOF",
  "cat <<< x",
  "function f { ls; }",
  "f() { ls; }",
  "case x in a) ls;; esac",
  "{ ls; }",
  "$CMD x",
  "*.sh",
  "timeout 5 $CMD",
  "echo 'a",
  'echo "a',
  "for f in *.ts; do wc $f; done",
  "for f in $(ls); do wc $f; done",
  "X=$(id) ls",
  "env -S 'ls -l'",
  "( ls",
  "ls &&",
];

/** A rule scoped to the line's first word, so only a read line could match. */
const scoped = (line: string): string =>
  `Bash(${line.split(/\s/u)[0] ?? ""}:*)`;

describe("the generated guard source on the reader's unread lines", () => {
  it("is what the reader leaves unread", () => {
    expect(UNREAD.filter(line => readShellLine(line) !== null)).toEqual([]);
  });

  it.each(UNREAD)("refuses %j to a scoped rule", async line => {
    const decide = await commandCode({ allow: [scoped(line)], deny: [] });
    expect(decide(line)).toBe("not allowed for this node");
  });

  it("lets a plain Bash rule allow every one", async () => {
    const decide = await commandCode({ allow: ["Bash"], deny: [] });
    expect(UNREAD.filter(line => decide(line) !== undefined)).toEqual([]);
  });
});
