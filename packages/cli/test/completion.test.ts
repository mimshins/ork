/**
 * @file Tests for tab completion's command tree and its candidates at each
 *   position: the tree is `ork`'s own commands (loaded ones resolved, `wt` an
 *   alias, `__complete` hidden), subcommands nested and grouped, flags without
 *   the internal ones, enum and driver values, and the scripts for each shell.
 */

import type { ArgsDef, CommandDef } from "citty";
import { describe, expect, it } from "vitest";

import { SHELL_SCRIPTS } from "../src/completion/scripts.ts";
import {
  commandTree,
  completion,
  completionLines,
  INTERNAL,
  main,
  resolved,
  subcommandsOf,
} from "../src/index.ts";
import { tempDir } from "./fixtures/completion.ts";
import { listRoot } from "./fixtures/list-root.ts";

/** The candidates (values only) for `words`, outside any project. */
const values = async (...words: string[]): Promise<string[]> =>
  (await completionLines(main, words, tempDir("ork-complete-cwd-"), "/none"))
    .filter(line => !line.startsWith(":"))
    .map(line => line.split("\t")[0] ?? "");

/** The raw lines for `words`, outside any project. */
const lines = (...words: string[]): Promise<string[]> =>
  completionLines(main, words, tempDir("ork-complete-cwd-"), "/none");

/** The names `ork`'s definition lists its subcommands under. */
const mainNames = async (): Promise<string[]> =>
  Object.keys(await resolved(main.subCommands ?? {})).toSorted();

/** A command's description. */
const descriptionOf = async <T extends ArgsDef>(
  cmd: CommandDef<T>,
): Promise<string> => (await resolved(cmd.meta ?? {})).description ?? "";

/** Every flag description in the whole tree. */
const flagDescriptions = async (): Promise<string[]> => {
  const walk = (tree: Awaited<ReturnType<typeof commandTree>>): string[] => [
    ...tree.flags.map(flag => flag.description),
    ...tree.subcommands.flatMap(sub => walk(sub)),
  ];
  return walk(await commandTree(main, "ork"));
};

describe("the command tree", () => {
  it("has every subcommand of `ork`, aliases folded in", async () => {
    const tree = await commandTree(main, "ork");
    const names = tree.subcommands.flatMap(sub => [sub.name, ...sub.aliases]);
    expect(names.toSorted()).toEqual(await mainNames());
    const worktrees = tree.subcommands.find(sub => sub.name === "worktrees");
    expect(worktrees?.aliases).toEqual(["wt"]);
    expect(worktrees?.subcommands.map(sub => sub.name)).toEqual([
      "list",
      "clean",
      "remove",
    ]);
  });

  it("marks __complete hidden and nothing else", async () => {
    const hidden = (await subcommandsOf(main)).filter(entry => entry.hidden);
    expect(hidden.map(entry => entry.name)).toEqual(["__complete"]);
  });

  it("leaves out every internal flag", async () => {
    const descriptions = await flagDescriptions();
    expect(descriptions.length).toBeGreaterThan(50);
    expect(descriptions.filter(d => d.startsWith(INTERNAL))).toEqual([]);
  });
});

describe("ork __complete", () => {
  it("offers the commands in --help's groups, not the hidden or alias ones", async () => {
    const all = await lines("");
    expect(all[0]).toBe(":group Get started");
    expect(all).toContain(":group Steer a running run");
    expect(all).toContain("run\tRun a workflow, or one node of it");
    expect(await values("")).not.toContain("__complete");
    expect(await values("")).not.toContain("wt");
  });

  it("completes a prefix", async () => {
    expect(await values("wor")).toEqual(["worktrees"]);
    expect(await values("co")).toEqual(["context", "continue", "completion"]);
  });

  it("completes nested subcommands, through an alias too", async () => {
    expect(await values("worktrees", "")).toEqual(["list", "clean", "remove"]);
    expect(await values("wt", "r")).toEqual(["remove"]);
    expect(await values("projects", "")).toEqual(["forget", "move"]);
    expect(await values("context", "")).toEqual(["explain"]);
    expect(await values("agents", "")).toEqual(["list", "show", "add", "rm"]);
    expect(await values("feedback", "a")).toEqual(["accept", "apply"]);
  });

  it("completes a command's flags with descriptions, never internal ones", async () => {
    const run = await lines("run", "--");
    expect(run[0]).toBe(":group flags");
    expect(run).toContain(
      "--detach\tRun in the background; follow it with ork logs -f, answer with ork decide",
    );
    expect(run.join("\n")).not.toContain("--run-id");
    expect(await values("ui", "--no")).toEqual(["--no-open"]);
    expect(await values("logs", "--f")).toEqual(["--follow"]);
  });

  it("completes a flag's values: drivers, and nothing for a free value", async () => {
    expect(await values("run", "--driver", "")).toEqual([
      "claude-code",
      "open-code",
      "command-code",
    ]);
    expect(await values("chat", "--driver", "cl")).toEqual(["claude-code"]);
    expect(await values("ps", "--limit", "")).toEqual([]);
  });

  it("completes `--flag=value` like `--flag value`, keeping the prefix", async () => {
    expect(await values("run", "--driver=")).toEqual([
      "--driver=claude-code",
      "--driver=open-code",
      "--driver=command-code",
    ]);
    expect(await values("chat", "--driver=cl")).toEqual([
      "--driver=claude-code",
    ]);
    // A boolean flag, `--flag` or `--flag=`, is still a flag.
    expect(await values("logs", "--follow")).toEqual(["--follow"]);
    expect(await values("logs", "--follow=")).toEqual([]);
  });

  it("knows a value flag takes the next word, and a boolean doesn't", async () => {
    expect(await values("run", "--driver", "claude-code", "--d")).toEqual([
      "--driver",
      "--detach",
    ]);
    expect(await values("logs", "--follow", "--n")).toEqual(["--node"]);
  });

  it("offers the shells, and asks for files where a path goes", async () => {
    expect(await values("completion", "")).toEqual(["zsh", "bash", "fish"]);
    expect(await lines("register", "")).toEqual([":files"]);
    expect(await lines("feedback", "export", "--output", "")).toEqual([
      ":files",
    ]);
  });

  it("offers Ork's own workflows outside a project", async () => {
    expect(await values("run", "ork:")).toEqual(["ork:feedback-apply"]);
  });
});

describe("ork completion", () => {
  it("has a script for each shell, each running ork __complete", () => {
    expect(Object.keys(SHELL_SCRIPTS)).toEqual(["zsh", "bash", "fish"]);
    expect(SHELL_SCRIPTS["zsh"]).toMatch(/^#compdef ork\n/u);
    expect(SHELL_SCRIPTS["zsh"]).toContain("compdef _ork ork");
    expect(SHELL_SCRIPTS["bash"]).toContain("complete -F _ork ork");
    expect(SHELL_SCRIPTS["fish"]).toContain("complete -c ork");
    const all = Object.values(SHELL_SCRIPTS).join("\n");
    expect(all.match(/ __complete -- /gu)).toHaveLength(3);
  });

  it("says the shell it takes", async () => {
    expect(await descriptionOf(completion)).toContain("zsh, bash, fish");
  });
});

const flagsOf = async (...words: string[]): Promise<string[]> =>
  (
    await completionLines(
      listRoot,
      [...words, "--"],
      tempDir("ork-list-"),
      "/none",
    )
  )
    .filter(line => !line.startsWith(":"))
    .map(line => line.split("\t")[0] ?? "");
const valuesOf = async (...words: string[]): Promise<string[]> =>
  (await completionLines(listRoot, words, tempDir("ork-list-"), "/none"))
    .filter(line => !line.startsWith(":"))
    .map(line => line.split("\t")[0] ?? "");

describe("a list's flags", () => {
  it("offers the table's flags, --ids, --limit and --json, never --all", async () => {
    const flags = await flagsOf("ps");
    expect(flags).toEqual(
      expect.arrayContaining([
        "--status",
        "--workflow",
        "--project",
        "--since",
        "--until",
        "--ids",
        "--limit",
        "--json",
      ]),
    );
    expect(flags).not.toContain("--all");
    expect(await flagsOf("follow-ups", "list")).not.toContain("--all");
  });

  it("offers an enum flag's values from the table, `all` where it takes it", async () => {
    expect(await valuesOf("ps", "--status", "")).toEqual(
      expect.arrayContaining(["running", "failed", "all"]),
    );
    expect(await valuesOf("follow-ups", "list", "--status", "d")).toEqual([
      "due",
      "done",
      "dropped",
    ]);
    expect(await valuesOf("follow-ups", "list", "--due", "a")).toEqual([
      "after-merge",
      "after-deploy",
    ]);
    expect(await valuesOf("follow-ups", "list", "--kind", "")).toContain(
      "task",
    );
  });

  it("knows --limit and --since take a free value", async () => {
    expect(await valuesOf("ps", "--limit", "")).toEqual([]);
    expect(await valuesOf("ps", "--ids", "--st")).toEqual(["--status"]);
  });
});
