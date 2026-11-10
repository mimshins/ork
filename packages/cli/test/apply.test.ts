/**
 * @file Tests for `ork feedback apply`: the item as the worker reads it, what a
 *   run of `ork:feedback-apply` ended with, and whole runs on a fake `claude`
 *   in a real repository: keeping the fix leaves its branch and resolves the
 *   item, discarding removes the branch and leaves the item accepted, and an
 *   `ork` item is refused.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type FeedbackItem,
  type HumanChannel,
  humanNoteEvent,
  openStore,
  type RunResult,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import {
  aboutItem,
  type Applied,
  type ApplyOptions,
  applyItem,
  outcomeOf,
} from "../src/runs/apply.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

/** A repository with one commit, its run state ignored. */
const gitProject = (): string => {
  const dir = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-apply-"))),
    "app",
  );
  mkdirSync(path.join(dir, ".ork", "workflows"), { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "# App\n");
  writeFileSync(path.join(dir, ".gitignore"), ".ork/runs/\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "-A"],
    ["commit", "-q", "-m", "init"],
  ]) {
    execFileSync("git", args, { cwd: dir });
  }
  return dir;
};

/** An item noted on a run of `notes` in the project at `root`. */
const noted = (
  root: string,
  kind: "context-gap" | "bug" = "context-gap",
): { store: EventStore; item: FeedbackItem } => {
  const store = openStore(":memory:");
  store.begin({
    id: "run0",
    workflow: "notes",
    file: path.join(root, ".ork", "workflows", "notes.ork.yaml"),
    project: root,
  });
  store.append(
    "run0",
    humanNoteEvent({
      text: "AGENTS.md has no test command\nThe builder guessed `npm test`.",
      workflow: "notes",
      node: "build",
      kind,
    }),
  );
  const [item] = store.feedbackItems();
  if (item === undefined) throw new Error("No item.");
  return { store, item };
};

/** Answers the gate with `choice`, and any other question as recommended. */
const answering = (choice: string): HumanChannel => ({
  ask: ({ options, recommended }) =>
    Promise.resolve(
      options.some(o => o.id === choice) ? choice : (recommended ?? ""),
    ),
  permit: () => Promise.resolve({ allow: true }),
});

const options = (
  store: EventStore,
  item: FeedbackItem,
  choice: string,
  commits = 1,
): ApplyOptions => ({
  ahead: () => Promise.resolve(commits),
  store,
  item,
  registered: [],
  runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
  driverChecks: openCodeReady,
  drivers: standInDrivers,
  human: answering(choice),
  home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
  out: () => {
    // The outcome is checked instead.
  },
  err: () => {
    // The outcome is checked instead.
  },
});

/** How an apply ended, or why it refused, as an error. */
const outcome = async (applying: Promise<Applied>): Promise<string> => {
  const applied = await applying;
  if (!applied.ok) throw new Error(applied.error);
  return applied.outcome.kind;
};

const branches = (root: string): string =>
  execFileSync("git", ["branch", "--list", "ork/*"], {
    cwd: root,
    encoding: "utf8",
  });

/** The item's status now; a run can record other items of its own. */
const statusOf = (store: EventStore, item: FeedbackItem): string =>
  store.findFeedback(item.id)[0]?.status ?? "none";

describe("the item as the worker reads it", () => {
  it("names the item and gives each record's words and node", () => {
    const { store, item } = noted(gitProject());
    const about = aboutItem(item, store.feedbackRecords(item.id));
    expect(about).toContain(
      `Item ${item.id.slice(0, 12)}: AGENTS.md has no test command`,
    );
    expect(about).toContain("About: project (context-gap)");
    expect(about).toContain("Record from run run0, node build (human):");
    expect(about).toContain("The builder guessed `npm test`.");
  });
});

const result = (nodes: RunResult["nodes"], status: RunResult["status"]) =>
  ({
    runId: "r1",
    status,
    costUsd: 0,
    nodes,
    reasons: ["fix failed"],
    worktrees: [],
  }) satisfies RunResult;

const fix = (ok: boolean, output: Record<string, unknown>) => ({
  id: "fix",
  runs: 1,
  ok,
  output,
  costUsd: 0,
});

describe("what a run of ork:feedback-apply ended with", () => {
  it("reads the gate's choice and the fix's branch", () => {
    const kept = result(
      [
        fix(true, { branch: "ork/r1/fix", summary: "Added it." }),
        {
          id: "keep",
          runs: 1,
          ok: true,
          output: { choice: "keep" },
          costUsd: 0,
        },
      ],
      "succeeded",
    );
    expect(outcomeOf(kept)).toEqual({
      kind: "kept",
      branch: "ork/r1/fix",
      summary: "Added it.",
    });
  });

  it("says when the worker proposed nothing, and when the run didn't end", () => {
    expect(
      outcomeOf(
        result([fix(false, { summary: "Nothing to change." })], "failed"),
      ),
    ).toEqual({ kind: "nothing", summary: "Nothing to change." });
    expect(outcomeOf(result([], "interrupted"))).toEqual({
      kind: "unfinished",
      reasons: ["fix failed"],
    });
  });
});

describe("ork feedback apply", () => {
  it("keeps the fix on its branch, and resolves the item", async () => {
    const root = gitProject();
    const { store, item } = noted(root);
    expect(await outcome(applyItem(options(store, item, "keep")))).toBe("kept");
    expect(branches(root)).toMatch(/ork\/[^/]+\/fix/u);
    expect(statusOf(store, item)).toBe("resolved");
  });

  it("keeps nothing when the fix's branch holds no commits", async () => {
    const root = gitProject();
    const { store, item } = noted(root);
    expect(await outcome(applyItem(options(store, item, "keep", 0)))).toBe(
      "kept",
    );
    expect(branches(root)).toBe("");
    expect(statusOf(store, item)).toBe("accepted");
  });

  it("refuses an item already resolved, and one dismissed", async () => {
    const root = gitProject();
    const { store, item } = noted(root);
    store.setFeedbackStatus(item.id, "resolved");
    expect(
      await applyItem(options(store, { ...item, status: "resolved" }, "keep")),
    ).toEqual({
      ok: false,
      error: `${item.id.slice(0, 12)} is resolved already.`,
    });
    expect(
      await applyItem(options(store, { ...item, status: "dismissed" }, "keep")),
    ).toEqual({
      ok: false,
      error: `${item.id.slice(0, 12)} is dismissed; restore it first.`,
    });
  });

  it("refuses an item whose project is gone", async () => {
    const root = gitProject();
    const { store, item } = noted(root);
    rmSync(root, { recursive: true, force: true });
    expect(await applyItem(options(store, item, "keep"))).toEqual({
      ok: false,
      error: `Its project at ${root} is gone.`,
    });
    expect(statusOf(store, item)).toBe("new");
  });

  it("removes a discarded fix's branch, and leaves the item accepted", async () => {
    const root = gitProject();
    const { store, item } = noted(root);
    expect(await outcome(applyItem(options(store, item, "discard")))).toBe(
      "discarded",
    );
    expect(branches(root)).toBe("");
    expect(statusOf(store, item)).toBe("accepted");
  });

  it("refuses an item about Ork itself", async () => {
    const root = gitProject();
    const { store, item } = noted(root, "bug");
    const applied = await applyItem(options(store, item, "keep"));
    expect(applied.ok).toBe(false);
    expect(statusOf(store, item)).toBe("new");
  });
});
