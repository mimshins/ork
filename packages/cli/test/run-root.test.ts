/**
 * @file Tests for a run's own working root (RFC-021 Option C): an attached
 *   project's `ork:security-audit` runs in a worktree of its commit beside the
 *   clone, with the bundle written in. A fake runtime and a stand-in tool
 *   runner record where each node worked; the run stops at `recon` (it reports
 *   `fail`), so `scan` and one session are enough to see that every node works
 *   in the worktree and reads the bundle there, that tool nodes get
 *   `ORK_SOURCE_ROOT`, that the user's checkout is untouched, and that the
 *   worktree goes when the run fails or is stopped, comes back at the recorded
 *   commit on resume, and is found and discarded by its run when a crash left
 *   it. An in-repo audit has none; a project with no repository, or a link at
 *   the worktree's place, stops the run before any node.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

import {
  type AgentRuntime,
  builtinWorkflowFile,
  createdWorktrees,
  createWorktree,
  type EventStore,
  inRepoPlace,
  listOrkWorktrees,
  openStore,
  placeFiles,
  type ProjectRecord,
  type RunHandle,
  type RuntimeEvent,
  type SessionSpec,
} from "@krapht/ork-core";
import type { ToolRunner } from "@krapht/ork-nodes";
import { describe, expect, it } from "vitest";

import { registerProject, runWorkflowFile } from "../src/index.ts";
import { discardRun } from "../src/runs/keep.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";
import {
  checkoutNow,
  clone,
  commit,
  git,
  onlyRun,
  readyToResume,
  registered,
  rootActions,
  rootOf,
  tmp,
  worktreesOf,
} from "./fixtures/run-root-kit.ts";

const USAGE = {
  costUsd: 0.01,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  durationMs: 1,
};

/** The bundle folder a text names (`.ork/runs/.builtin/<hash>`). */
const bundleIn = (text: string): string =>
  /\.ork\/runs\/\.builtin\/[0-9a-f]{12}/u.exec(text)?.[0] ?? "(none)";

/** What one session saw: its cwd, whether the skill was there, its commit. */
type Seen = { node: string; cwd: string; skillReadable: boolean; head: string };

/** A runtime whose every session reports `fail`, after looking around. */
const failingRuntime = (seen: Seen[]): AgentRuntime => ({
  driver: "open-code",
  start: (spec: SessionSpec) => {
    seen.push({
      node: spec.nodeId,
      cwd: spec.cwd,
      skillReadable: existsSync(
        path.join(
          spec.cwd,
          bundleIn(spec.prompt),
          "security-audit/skill/SKILL.md",
        ),
      ),
      head: git(spec.cwd, "rev-parse", "HEAD").trim(),
    });
    const events = (async function* (): AsyncGenerator<RuntimeEvent> {
      await Promise.resolve();
      yield {
        type: "session.started",
        sessionId: "s",
        model: "fake",
        cwd: spec.cwd,
        driver: "open-code",
      };
      yield {
        type: "session.finished",
        outcome: {
          subtype: "success",
          sessionId: "s",
          report: {
            status: "fail",
            summary: "the test stops here",
            artifacts: {},
            fields: {},
          },
          text: "done",
          usage: USAGE,
          errors: [],
        },
      };
    })();
    return { events, send: () => {}, interrupt: () => Promise.resolve() };
  },
});

/** What `scan` saw: where it ran, its script, its env, what its folder held. */
type Ran = {
  cwd: string;
  script: string;
  env: Record<string, string>;
  cliThere: boolean;
  secretThere: boolean;
};

/** A tool runner that answers `scan`, records it, then calls `then`. */
const scanRunner =
  (ran: Ran[], then: () => void): ToolRunner =>
  (_program, args, { cwd, env }) => {
    // `sh -eu <file>`: the script's text is in the file.
    const script = readFileSync(args.at(-1) ?? "", "utf8");
    ran.push({
      cwd,
      script,
      env: { ...env },
      cliThere: existsSync(
        path.join(cwd, bundleIn(script), "security-audit/cli.ts"),
      ),
      secretThere: existsSync(path.join(cwd, ".env")),
    });
    then();
    return Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify({
        findings: [],
        notes: [],
        previousDir: "",
        previousText: "null",
      }),
      stderr: "",
    });
  };

type RunOptions = Parameters<typeof runWorkflowFile>[0];

/** Runs `file` from `root` with the fakes; `stop` interrupts it at `scan`. */
const runner = (
  root: string,
  home: string,
  store: EventStore,
  file: string,
) => {
  const seen: Seen[] = [];
  const ran: Ran[] = [];
  const errors: string[] = [];
  const live: { handle?: RunHandle; stop: boolean } = { stop: false };
  const run = (more: Partial<RunOptions> = {}) =>
    runWorkflowFile({
      file,
      cwd: root,
      inputs: [],
      inPlace: false,
      json: true,
      runtime: () => Promise.resolve(failingRuntime(seen)),
      driverChecks: openCodeReady,
      drivers: standInDrivers,
      store,
      home,
      tools: scanRunner(ran, () => {
        if (live.stop) live.handle?.interrupt();
      }),
      onRun: handle => {
        live.handle = handle;
      },
      out: () => {},
      err: line => {
        errors.push(line);
      },
      ...more,
    });
  return { seen, ran, errors, live, run };
};

/** An attached project's clone, its audit, and what its checkout held. */
const attached = () => {
  const root = clone();
  const home = tmp("ork-home-");
  const store = openStore(":memory:");
  const project: ProjectRecord = registered(
    registerProject(store, root, { home }),
  );
  const file = builtinWorkflowFile(project, "ork:security-audit") ?? "";
  const status = git(root, "status", "--porcelain");
  const exclude = readFileSync(
    path.join(root, ".git", "info", "exclude"),
    "utf8",
  );
  return {
    root,
    home,
    store,
    project,
    file,
    status,
    exclude,
    ...runner(root, home, store, file),
  };
};

/** The audit's workflow file, written into the in-repo project at `root`. */
const inRepoAudit = (root: string): string =>
  builtinWorkflowFile(inRepoPlace(root), "ork:security-audit") ?? "";

describe("an attached audit's run root", () => {
  it("runs scan and the agents in the worktree, and leaves the checkout alone", async () => {
    const s = attached();
    const first = await s.run();
    expect(first.result?.status).toBe("failed");
    const record = onlyRun(s.store);
    const worktree = rootOf(s.root, record.id);

    expect(s.ran).toHaveLength(1);
    expect(s.ran[0]).toMatchObject({
      cwd: worktree,
      cliThere: true,
      secretThere: false,
    });
    expect(s.ran[0]?.env).toMatchObject({
      ORK_PROJECT: worktree,
      ORK_SOURCE_ROOT: s.root,
    });
    expect(s.seen).toEqual([
      expect.objectContaining({
        node: "recon",
        cwd: worktree,
        skillReadable: true,
      }),
    ]);

    // The store and events stay with the user's project.
    expect(record.project).toBe(s.root);
    expect(
      existsSync(
        path.join(placeFiles(s.project).runs, record.id, "events.jsonl"),
      ),
    ).toBe(true);
    expect(rootActions(s.store, record.id)).toEqual(["created", "removed"]);

    expect(existsSync(worktree)).toBe(false);
    expect(checkoutNow(s.root)).toEqual({
      status: s.status,
      exclude: s.exclude,
      orkThere: false,
      worktrees: [s.root],
      branches: "",
    });
  });

  it("removes the worktree when the run is stopped", async () => {
    const s = attached();
    s.live.stop = true;
    const stopped = await s.run();
    expect(stopped.exitCode).toBe(1);
    expect(s.seen).toEqual([]);
    const record = onlyRun(s.store);
    expect(existsSync(rootOf(s.root, record.id))).toBe(false);
    expect(rootActions(s.store, record.id)).toEqual(["created", "removed"]);
    expect(checkoutNow(s.root).worktrees).toEqual([s.root]);
  });

  it("re-creates it on resume at the recorded commit, with the bundle", async () => {
    const s = attached();
    await s.run();
    const record = onlyRun(s.store);
    const head = git(s.root, "rev-parse", "HEAD").trim();
    // HEAD moves on after the run started: the resume audits the first.
    commit(s.root, "later");
    const state = readyToResume(s.store, record);
    expect(state.settings.baseRef).toBe(head);

    const again = await s.run({ runId: record.id, resume: state });
    expect(again.result?.status).toBe("failed");
    const worktree = rootOf(s.root, record.id);
    expect(
      s.seen.map(seen => [seen.cwd, seen.head, seen.skillReadable]),
    ).toEqual([
      [worktree, head, true],
      [worktree, head, true],
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(checkoutNow(s.root).branches).toBe("");
  });

  it("lists a crash's leftover by its run, adopts it on resume, and discard removes it", async () => {
    const s = attached();
    await s.run();
    const record = onlyRun(s.store);
    const worktree = rootOf(s.root, record.id);
    const head = git(s.root, "rev-parse", "HEAD").trim();
    // What a crash leaves: the folder, on the run root's branch.
    const leave = () =>
      createWorktree({
        root: s.root,
        path: worktree,
        branch: `ork/${record.id}/audit-root`,
        base: head,
        known: true,
      });

    await leave();
    const listed = await listOrkWorktrees(
      s.root,
      createdWorktrees(s.store, s.root),
    );
    expect(listed.map(item => [item.runId, item.nodeId, item.path])).toEqual([
      [record.id, "audit-root", worktree],
    ]);
    await s.run({ runId: record.id, resume: readyToResume(s.store, record) });
    expect(s.seen.map(seen => seen.cwd)).toEqual([worktree, worktree]);
    expect(existsSync(worktree)).toBe(false);

    await leave();
    await discardRun(s.store, s.root, record.id);
    expect(existsSync(worktree)).toBe(false);
    expect(checkoutNow(s.root)).toMatchObject({
      status: s.status,
      worktrees: [s.root],
      branches: "",
    });
  });

  it("stops before any node when the project has no repository", async () => {
    const s = attached();
    rmSync(path.join(s.root, ".git"), { recursive: true, force: true });
    const result = await s.run();
    expect(result).toEqual({ exitCode: 1, result: null });
    expect([s.ran, s.seen, s.store.runs()]).toEqual([[], [], []]);
    expect(s.errors.join("\n")).toContain("is not a git repository");
  });

  it("stops before any node when a link holds the worktree's place", async () => {
    const s = attached();
    const elsewhere = tmp("ork-elsewhere-");
    const at = rootOf(s.root, "r-link");
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(elsewhere, at);
    const result = await s.run({ runId: "r-link" });
    expect(result).toEqual({ exitCode: 1, result: null });
    expect([s.ran, s.seen, s.store.runs()]).toEqual([[], [], []]);
    expect(s.errors.join("\n")).toContain("is a link");
    expect(checkoutNow(s.root).worktrees).toEqual([s.root]);
  });

  it("leaves a missing workflow file to the load, with no run root", async () => {
    const s = attached();
    const missing = path.join(path.dirname(s.file), "gone.ork.yaml");
    const result = await s.run({ file: missing });
    expect(result.exitCode).toBe(1);
    expect(s.store.runs()).toEqual([]);
    expect(checkoutNow(s.root).worktrees).toEqual([s.root]);
  });

  it("leaves an unreadable workflow file to the load, with no run root", async () => {
    const s = attached();
    const unreadable = path.join(path.dirname(s.file), "locked.ork.yaml");
    mkdirSync(unreadable);
    const result = await s.run({ file: unreadable });
    expect(result.exitCode).toBe(1);
    expect(s.store.runs()).toEqual([]);
    expect(checkoutNow(s.root).worktrees).toEqual([s.root]);
  });

  it("closes the worktree and exits 1 when the bundle write is refused", async () => {
    const s = attached();
    // A committed link where the bundle goes: the worktree checks it out.
    symlinkSync(tmp("ork-elsewhere-"), path.join(s.root, ".ork"));
    git(s.root, "add", ".ork");
    commit(s.root, "link");
    const result = await s.run();
    expect(result).toEqual({ exitCode: 1, result: null });
    expect([s.ran, s.seen]).toEqual([[], []]);
    expect(s.errors.join("\n")).toContain("is a link");
    expect(checkoutNow(s.root).worktrees).toEqual([s.root]);
    expect(checkoutNow(s.root).branches).toBe("");
  });
});

describe("an in-repo audit", () => {
  it("has no run root and no ORK_SOURCE_ROOT", async () => {
    const root = clone();
    const store = openStore(":memory:");
    const s = runner(root, tmp("ork-home-"), store, inRepoAudit(root));
    await s.run();
    const record = onlyRun(store);
    expect(s.ran.map(ran => [ran.cwd, ran.env["ORK_SOURCE_ROOT"]])).toEqual([
      [root, undefined],
    ]);
    expect(rootActions(store, record.id)).toEqual([]);
    expect(worktreesOf(root)).toEqual([root]);
  });
});
