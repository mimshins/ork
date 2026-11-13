/**
 * @file Tests for tab completion's live values, read from a project and a store
 *   in a temporary home: workflows, runs newest first with workflow and status,
 *   a run's or a workflow's nodes and inputs, open decisions; the store is only
 *   read (never created, never changed, refused at another version), errors
 *   print nothing, and 500 runs don't slow it down.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { followUpStore, openStore } from "@krapht/ork-core";
import type { CommandDef } from "citty";
import { describe, expect, it, vi } from "vitest";

import { completionLines, main, printCompletions } from "../src/index.ts";
import { seedStore, tempDir } from "./fixtures/completion.ts";
import { listRoot } from "./fixtures/list-root.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** The candidates' lines (values and descriptions) for `words`. */
const offered = async (
  seeded: { project: string; storeFile: string },
  ...words: string[]
): Promise<string[]> =>
  (await completionLines(main, words, seeded.project, seeded.storeFile)).filter(
    line => !line.startsWith(":"),
  );

const valuesOf = (lines: readonly string[]): string[] =>
  lines.map(line => line.split("\t")[0] ?? "");

/** `ork __complete -- <words…>` run as a program, in a home of its own. */
const spawnComplete = (home: string, cwd: string, words: string[]) =>
  spawnSync(process.execPath, [BIN, "__complete", "--", ...words], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: home },
  });

/** `ork <args…>` piped into `true`, which quits at once: its exit and stderr. */
const intoClosedPipe = (home: string, args: string[]) => {
  const run = 'node "$1" "${@:2}" | true; echo "${PIPESTATUS[0]}"';
  return spawnSync("/bin/bash", ["-c", run, "_", BIN, ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", HOME: home },
  });
};

/** What printCompletions writes to stdout. */
const printed = async (root: CommandDef, words: string[]): Promise<string> => {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await printCompletions(root, ["--", ...words]);
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
};

describe("completion values", () => {
  it("offers the project's workflows, then Ork's own", async () => {
    const seeded = seedStore();
    expect(valuesOf(await offered(seeded, "run", ""))).toEqual([
      "hello",
      "ork:feedback-apply",
    ]);
    expect(valuesOf(await offered(seeded, "validate", "h"))).toEqual(["hello"]);
  });

  it("offers the project's runs newest first, with workflow and status", async () => {
    const seeded = seedStore();
    expect(await offered(seeded, "logs", "")).toEqual([
      "live1\thello · running",
      "done1\thello · succeeded",
    ]);
    expect(valuesOf(await offered(seeded, "stop", "d"))).toEqual(["done1"]);
  });

  it("offers another project's run by its prefix", async () => {
    const seeded = seedStore();
    expect(valuesOf(await offered(seeded, "tree", "oth"))).toEqual(["other1"]);
  });

  it("offers a run's nodes, the newest run's when none is given", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "logs", "live1", "--node", "")),
    ).toEqual(["plan", "build"]);
    expect(valuesOf(await offered(seeded, "pause", "--node", "b"))).toEqual([
      "build",
    ]);
    expect(valuesOf(await offered(seeded, "chat", "live1", ""))).toEqual([
      "plan",
      "build",
    ]);
  });

  it("offers a workflow's nodes, once the workflow is given", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "run", "hello", "--node", "")),
    ).toEqual(["plan", "build"]);
    expect(valuesOf(await offered(seeded, "run", "--node", ""))).toEqual([]);
    expect(
      valuesOf(await offered(seeded, "context", "explain", "hello", "")),
    ).toEqual(["plan", "build"]);
  });

  it("offers a workflow's inputs as name=, once the workflow is given", async () => {
    const seeded = seedStore();
    expect(await offered(seeded, "run", "hello", "--input", "")).toEqual([
      "topic=\tWhat to say hello about (required)",
      "loud=\tboolean",
    ]);
    expect(
      valuesOf(await offered(seeded, "run", "hello", "--input", "t")),
    ).toEqual(["topic="]);
    expect(await offered(seeded, "run", "--input", "")).toEqual([]);
  });

  it("completes `--input=` and `--node=` like `--input ` and `--node `", async () => {
    const seeded = seedStore();
    expect(await offered(seeded, "run", "hello", "--input=")).toEqual(
      (await offered(seeded, "run", "hello", "--input", "")).map(
        line => `--input=${line}`,
      ),
    );
    expect(
      valuesOf(await offered(seeded, "run", "hello", "--input=t")),
    ).toEqual(["--input=topic="]);
    expect(valuesOf(await offered(seeded, "run", "hello", "--node="))).toEqual([
      "--node=plan",
      "--node=build",
    ]);
  });

  it("offers a run's inputs to ork resume --input", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "resume", "done1", "--input", "")),
    ).toEqual(["topic=", "loud="]);
  });

  it("offers open decisions by id, never their question", async () => {
    const seeded = seedStore();
    const lines = await offered(seeded, "decide", "--id", "");
    expect(lines).toEqual(["live1-1\tquestion of live1/build"]);
    expect(lines.join("\n")).not.toContain("never shows");
  });

  it("offers the project's runs for decide's run positional", async () => {
    const seeded = seedStore();
    expect(valuesOf(await offered(seeded, "decide", ""))).toEqual(
      expect.arrayContaining(["live1", "done1"]),
    );
    expect(valuesOf(await offered(seeded, "decide", "d"))).toEqual(["done1"]);
  });

  it("narrows decide --id to the run given as the positional", async () => {
    const seeded = seedStore();
    expect(
      valuesOf(await offered(seeded, "decide", "live1", "--id", "")),
    ).toEqual(["live1-1"]);
    expect(
      valuesOf(await offered(seeded, "decide", "done1", "--id", "")),
    ).toEqual([]);
  });
});

describe("the store, for completion", () => {
  it("is only read: its file is unchanged", async () => {
    const seeded = seedStore();
    const before = readFileSync(seeded.storeFile);
    const { mtimeMs } = statSync(seeded.storeFile);
    await offered(seeded, "logs", "");
    await offered(seeded, "decide", "--id", "");
    expect(readFileSync(seeded.storeFile).equals(before)).toBe(true);
    expect(statSync(seeded.storeFile).mtimeMs).toBe(mtimeMs);
  });

  it("gives no values at another schema version, and the rest still", async () => {
    const seeded = seedStore();
    const db = new DatabaseSync(seeded.storeFile);
    db.exec("PRAGMA user_version = 999");
    db.close();
    expect(await offered(seeded, "logs", "")).toEqual([]);
    expect(valuesOf(await offered(seeded, "logs", "--j"))).toEqual(["--json"]);
  });

  it("is never created: ork __complete leaves a fresh home empty", () => {
    const home = tempDir("ork-complete-fresh-");
    const result = spawnComplete(home, seedStore().project, ["logs", ""]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(existsSync(path.join(home, ".ork"))).toBe(false);
  });

  it("answers through the program, a typed --help completed, not obeyed", () => {
    const seeded = seedStore();
    const result = spawnComplete(seeded.home, seeded.project, [
      "run",
      "--help",
      "--dr",
    ]);
    expect(result.stdout).toBe(
      ":group flags\n--driver\tclaude-code, open-code, command-code (default: the driver ready here)\n",
    );
    expect(result.stderr).toBe("");
  });

  it("exits 0 with no trace when the reader closes the pipe", () => {
    const home = tempDir("ork-complete-pipe-");
    for (const args of [
      ["completion", "zsh"],
      ["__complete", "--", "run", ""],
    ]) {
      const result = intoClosedPipe(home, args);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("0\n");
    }
  });

  it("prints nothing when completing fails", async () => {
    const broken: CommandDef = {
      subCommands: () => Promise.reject(new Error("broken")),
    };
    expect(await printed(broken, [""])).toBe("");
  });

  it("stays quick on a store with 500 runs", async () => {
    const seeded = seedStore(500);
    await offered(seeded, "");
    const started = performance.now();
    const lines = await offered(seeded, "logs", "");
    // In process it takes tens of milliseconds; the wide margin only catches a
    // query that grows with the store, not a slow machine.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(lines).toHaveLength(50);
  });
});

/** The seeded store with two registered projects. */
const withProjects = (): ReturnType<typeof seedStore> => {
  const seeded = seedStore();
  const store = openStore(seeded.storeFile);
  store.addProject({
    id: "ork",
    root: seeded.project,
    mode: "in-repo",
    dir: path.join(seeded.project, ".ork"),
  });
  store.addProject({
    id: "web",
    root: "/code/web",
    mode: "in-repo",
    dir: "/d/web",
  });
  store.close();
  return seeded;
};
const listed = async (
  seeded: { project: string; storeFile: string },
  ...words: string[]
): Promise<string[]> =>
  (await completionLines(listRoot, words, seeded.project, seeded.storeFile))
    .filter(line => !line.startsWith(":"))
    .map(line => line.split("\t")[0] ?? "");

describe("a list's dynamic values", () => {
  it("offers all and the registered projects for --project", async () => {
    const seeded = withProjects();
    expect(await listed(seeded, "ps", "--project", "")).toEqual([
      "all",
      "ork",
      "web",
    ]);
    expect(
      await listed(seeded, "follow-ups", "list", "--project", "w"),
    ).toEqual(["web"]);
  });

  it("offers agent, me and project:<id> for --for", async () => {
    const seeded = withProjects();
    expect(await listed(seeded, "follow-ups", "list", "--for", "")).toEqual([
      "agent",
      "me",
      "project:ork",
      "project:web",
    ]);
    expect(await listed(seeded, "follow-ups", "list", "--for", "p")).toEqual([
      "project:ork",
      "project:web",
    ]);
  });

  it("offers the project's workflows for --workflow, and its runs for --run", async () => {
    const seeded = withProjects();
    expect(await listed(seeded, "ps", "--workflow", "h")).toEqual(["hello"]);
    expect(await listed(seeded, "worktrees", "list", "--run", "d")).toEqual([
      "done1",
    ]);
  });

  it("offers nothing dynamic when the store can't be read, but the rest still", async () => {
    const seeded = seedStore();
    expect(
      await listed({ ...seeded, storeFile: "/none" }, "ps", "--project", ""),
    ).toEqual(["all"]);
    expect(
      await listed(
        { ...seeded, storeFile: "/none" },
        "follow-ups",
        "list",
        "--for",
        "",
      ),
    ).toEqual(["agent", "me"]);
  });
});

/** The seeded store with agent follow-ups: waiting, due, done, and one for me. */
const withFollowUps = async (): Promise<{
  seeded: ReturnType<typeof seedStore>;
  ids: Record<"waiting" | "due" | "done" | "me", string>;
}> => {
  const seeded = seedStore();
  const store = openStore(seeded.storeFile);
  const follow = followUpStore({
    rows: store,
    project: seeded.project,
    home: tempDir("ork-complete-fu-home-"),
  });
  const add = async (
    title: string,
    patch: { for?: "agent" | "me"; due?: "now" | "after-merge" },
  ): Promise<string> =>
    (
      await follow.add({
        title,
        body: "The body completion never shows",
        for: patch.for ?? "agent",
        kind: "change",
        due: patch.due ?? "now",
        where: [],
      })
    ).followUp.id;
  const ids = {
    waiting: await add("Wait for the merge\nsecond line", {
      due: "after-merge",
    }),
    due: await add("Add retries", {}),
    done: await add("Already done", {}),
    me: await add("Check the dashboards", { for: "me" }),
  };
  for (const f of store.followUps(seeded.project)) {
    if (f.id === ids.done) store.putFollowUp({ ...f, status: "done" });
  }
  store.close();
  return { seeded, ids };
};

describe("--follow-ups values of `ork run`", () => {
  it("offers due first, then the open agent follow-ups with their titles", async () => {
    const { seeded, ids } = await withFollowUps();
    expect(await offered(seeded, "run", "start", "--follow-ups", "")).toEqual([
      "due\tevery due agent follow-up",
      `${ids.due}\tAdd retries`,
      `${ids.waiting}\tWait for the merge`,
    ]);
  });

  it("offers only due when the store can't be read", async () => {
    const { seeded } = await withFollowUps();
    expect(
      await offered(
        { ...seeded, storeFile: "/none" },
        "run",
        "start",
        "--follow-ups",
        "",
      ),
    ).toEqual(["due\tevery due agent follow-up"]);
  });
});
