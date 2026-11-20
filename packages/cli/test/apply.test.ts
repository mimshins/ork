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
  readFileSync,
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
  type SessionPorts,
  type SessionSpec,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it, vi } from "vitest";

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

/** Makes the project at `root` keep a run's work uncommitted. */
const neverCommit = (root: string): void => {
  writeFileSync(
    path.join(root, ".ork", "project.yaml"),
    "schemaVersion: 1\ngit: { commit: never }\n",
  );
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "never"], { cwd: root });
};

/** Commits `.ork/project.yaml` with `body` after its schema line. */
const withProjectFile = (root: string, body: string): void => {
  writeFileSync(
    path.join(root, ".ork", "project.yaml"),
    `schemaVersion: 1\n${body}\n`,
  );
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "project"], { cwd: root });
};

/** A fake-claude runtime that records each session's `writeOnly` and prompt. */
const limitsOf = () => {
  const seen: (string[] | undefined)[] = [];
  const prompts: string[] = [];
  const inner = createCliRuntime({ bin: FAKE_CLAUDE });
  return {
    seen,
    prompts,
    runtime: () =>
      Promise.resolve({
        ...inner,
        start: (spec: SessionSpec, ports: SessionPorts) => {
          seen.push(spec.writeOnly);
          prompts.push(spec.prompt);
          return inner.start(spec, ports);
        },
      }),
  };
};

/** What `git status --short` says in `root`. */
const gitStatus = (root: string): string =>
  execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" });

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

/** What an apply said first, or why it refused, as an error. */
const firstLine = async (applying: Promise<Applied>): Promise<string> => {
  const applied = await applying;
  if (!applied.ok) throw new Error(applied.error);
  return applied.lines[0] ?? "";
};

/** Why an apply refused, or an error when it ran. */
const refusal = async (applying: Promise<Applied>): Promise<string> => {
  const applied = await applying;
  if (applied.ok) throw new Error("It ran.");
  return applied.error;
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
      worktree: "",
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

  it("applies an uncommitted fix to the checkout under commit: never", async () => {
    vi.stubEnv("FAKE_CLAUDE_EDIT", "FIX.md");
    const root = gitProject();
    neverCommit(root);
    const { store, item } = noted(root);
    const first = await firstLine(applyItem(options(store, item, "keep")));
    vi.unstubAllEnvs();
    expect(first).toMatch(
      /^kept the fix in this checkout, uncommitted \(FIX\.md\)/u,
    );
    expect(gitStatus(root)).toBe("?? FIX.md\n");
    expect(branches(root)).toBe("");
    expect(statusOf(store, item)).toBe("resolved");
  });

  it("leaves the checkout as it was when the uncommitted fix doesn't apply", async () => {
    vi.stubEnv("FAKE_CLAUDE_EDIT", "FIX.md");
    const root = gitProject();
    neverCommit(root);
    writeFileSync(path.join(root, "FIX.md"), "mine\n");
    const { store, item } = noted(root);
    const first = await firstLine(applyItem(options(store, item, "keep")));
    vi.unstubAllEnvs();
    expect(first).toMatch(
      /^the fix doesn't apply over this checkout's own changes/u,
    );
    expect(readFileSync(path.join(root, "FIX.md"), "utf8")).toBe("mine\n");
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

  it("holds the worker to .ork/ under knowledge: ork-only", async () => {
    const root = gitProject();
    withProjectFile(root, "knowledge: ork-only");
    const { store, item } = noted(root);
    const limits = limitsOf();
    await applyItem({
      ...options(store, item, "discard"),
      runtime: limits.runtime,
    });
    expect(limits.seen).toEqual([[".ork"]]);
    expect(limits.prompts.join("\n")).toContain("only under .ork/");
  });

  it.each([["knowledge: any"], [""]])(
    "sets no write limit when the project says `%s`",
    async yaml => {
      const root = gitProject();
      withProjectFile(root, yaml);
      const { store, item } = noted(root);
      const limits = limitsOf();
      await applyItem({
        ...options(store, item, "discard"),
        runtime: limits.runtime,
      });
      expect(limits.seen).toEqual([undefined]);
      expect(limits.prompts.join("\n")).not.toContain("only under .ork/");
    },
  );

  it("refuses when the project's rules file can't be read, naming its problem", async () => {
    const root = gitProject();
    withProjectFile(root, "knowledge: [ork-only");
    const { store, item } = noted(root);
    const limits = limitsOf();
    const why = await refusal(
      applyItem({
        ...options(store, item, "keep"),
        runtime: limits.runtime,
      }),
    );
    expect(why).toMatch(/rules file can't be read.*\n.*project\.yaml/u);
    expect(limits.seen).toEqual([]);
    expect(statusOf(store, item)).toBe("new");
  });

  it("refuses an attached project under knowledge: ork-only, naming the rule", async () => {
    const root = gitProject();
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "ork-att-")), "p1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "project.yaml"),
      "schemaVersion: 1\nknowledge: ork-only\n",
    );
    const { store, item } = noted(root);
    const why = await refusal(
      applyItem({
        ...options(store, item, "keep"),
        registered: [{ root, mode: "attached", dir, id: "p1" }],
      }),
    );
    expect(why).toMatch(/`knowledge: ork-only`.*attached.*not supported/u);
    expect(statusOf(store, item)).toBe("new");
  });

  it("refuses an item about Ork itself", async () => {
    const root = gitProject();
    const { store, item } = noted(root, "bug");
    const applied = await applyItem(options(store, item, "keep"));
    expect(applied.ok).toBe(false);
    expect(statusOf(store, item)).toBe("new");
  });
});
