/**
 * @file End-to-end test of `ork:security-audit` in an attached project (RFC-021
 *   Option C): the real workflow, the real `tool.shell` programs (`scan`,
 *   `ledger`, `consolidate`, `findings`, `finalize`, `write`, `discard`) and a
 *   fake runtime whose agents answer what the audit's later nodes need, driven
 *   to a succeeded finish. It shows that every node, agent and tool, works in
 *   the run's worktree and never in the user's checkout; that the checkout is
 *   the same after the run; that the worktree is gone after a finish, a gate
 *   `discard` and a failed first try that a resume then finishes at the
 *   recorded commit; and that the written REPORT names the audited commit and,
 *   when the checkout has uncommitted changes, says they are not audited. An
 *   in-repo audit has no run worktree and no such lines.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type AgentRuntime,
  builtinWorkflowFile,
  type EventStore,
  type HumanChannel,
  inRepoPlace,
  openStore,
  type RuntimeEvent,
  type SessionSpec,
} from "@krapht/ork-core";
import { spawnTool, type ToolRunner } from "@krapht/ork-nodes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerProject, runWorkflowFile } from "../src/index.ts";
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

/** One recon unit in the coverage ledger's shape. */
const UNIT = {
  surface: "the app's entry",
  boundary: "local user to the process",
  subsystem: "profile/quick/all-in-scope-subsystems",
  attack_class: "authz",
  starting_paths: ["index.js"],
  ordinary_attack_class_block: "ATTACK-CLASSES.md",
  selected_companion_blocks: [],
  excluded_blocks: [],
  prior_status: "new",
};

/** What each agent node returns: enough for the nodes after it to finish. */
const ANSWERS: Record<string, Record<string, unknown>> = {
  recon: { architecture: "A one-file app.", units: [UNIT] },
  hunt: { candidates: [], hardening: [], uncovered: [] },
  critic: { gaps: [], missing_units: [], stop: true },
  report: { posture: "A partial pass.", hardening: [], positive: [] },
};

/** The bundle folder a text names (`.ork/runs/.builtin/<hash>`). */
const bundleIn = (text: string): string =>
  /\.ork\/runs\/\.builtin\/[0-9a-f]{12}/u.exec(text)?.[0] ?? "(none)";

/** Whether a prompt names the bundle, and if so whether its skill is there. */
type Skill = "none" | "readable" | "missing";

const skillFor = (cwd: string, prompt: string): Skill => {
  const bundle = bundleIn(prompt);
  if (bundle === "(none)") return "none";
  return existsSync(path.join(cwd, bundle, "security-audit/skill/SKILL.md"))
    ? "readable"
    : "missing";
};

/** What one agent session saw: where, on what commit, and the skill's file. */
type Seen = { node: string; cwd: string; head: string; skill: Skill };

/** `hunt` for its per-item ids (`hunt[0]`, `hunt/0`), the node's id otherwise. */
const nodeOf = (id: string): string => /^[A-Za-z0-9_-]+/u.exec(id)?.[0] ?? id;

/**
 * A runtime whose agents answer from `ANSWERS`; `recon` reports `fail` while
 * `failRecon.on` is set. Every session records what it saw.
 */
const auditRuntime = (
  seen: Seen[],
  failRecon: { on: boolean },
): AgentRuntime => ({
  driver: "open-code",
  start: (spec: SessionSpec) => {
    const node = nodeOf(spec.nodeId);
    seen.push({
      node,
      cwd: spec.cwd,
      head: git(spec.cwd, "rev-parse", "HEAD").trim(),
      skill: skillFor(spec.cwd, spec.prompt),
    });
    const failed = failRecon.on && node === "recon";
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
            status: failed ? "fail" : "pass",
            summary: failed ? "the test stops here" : "done",
            artifacts: {},
            fields: ANSWERS[node] ?? {},
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

/** Answers the review gate with `choice`. */
const answering = (choice: string): HumanChannel => ({
  ask: ({ options, recommended }) =>
    Promise.resolve(
      options.some(o => o.id === choice) ? choice : (recommended ?? ""),
    ),
  permit: () => Promise.resolve({ allow: true }),
});

type RunOptions = Parameters<typeof runWorkflowFile>[0];

/** An audit's fixture: a project, its workflow file, and a way to run it. */
const setUp = ({
  attachedProject = true,
  dirty = true,
}: { attachedProject?: boolean; dirty?: boolean } = {}) => {
  const root = clone(dirty);
  const home = tmp("ork-home-");
  const store: EventStore = openStore(":memory:");
  const place = attachedProject
    ? registered(registerProject(store, root, { home }))
    : inRepoPlace(root);
  const file = builtinWorkflowFile(place, "ork:security-audit") ?? "";
  // Taken after the bundle is written: an in-repo audit adds `.ork` itself.
  const before = checkoutNow(root);
  const seen: Seen[] = [];
  const cwds: string[] = [];
  const errors: string[] = [];
  const failRecon = { on: false };
  const tools: ToolRunner = (program, args, options) => {
    cwds.push(options.cwd);
    return spawnTool(program, args, options);
  };
  const run = (choice: string, more: Partial<RunOptions> = {}) =>
    runWorkflowFile({
      file,
      cwd: root,
      inputs: [],
      inPlace: false,
      json: true,
      runtime: () => Promise.resolve(auditRuntime(seen, failRecon)),
      driverChecks: openCodeReady,
      drivers: standInDrivers,
      store,
      home,
      tools,
      human: answering(choice),
      out: () => {},
      err: line => {
        errors.push(line);
      },
      ...more,
    });
  return { root, home, store, before, seen, cwds, errors, failRecon, run };
};

type Setup = ReturnType<typeof setUp>;

/** Where the audit's files for the run are, in the test's audit home. */
const auditFolder = (s: Setup, runId: string): string =>
  path.join(s.home, ".ork", "audits", "app", runId);

const reportOf = (s: Setup, runId: string): string =>
  readFileSync(path.join(auditFolder(s, runId), "REPORT.md"), "utf8");

const headOf = (root: string): string => git(root, "rev-parse", "HEAD").trim();

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Sends the audit's reports to `s`'s home, as `~/.ork/audits` would be. */
const auditHomeOf = (s: Setup): Setup => {
  vi.stubEnv("ORK_AUDIT_HOME", path.join(s.home, ".ork", "audits"));
  return s;
};

const audit = (more?: Parameters<typeof setUp>[0]): Setup =>
  auditHomeOf(setUp(more));

/** The prompts that name the bundle read its skill; the report's names none. */
const expectSkills = (s: Setup) => {
  expect(s.seen.map(seen => seen.skill)).toEqual([
    "readable",
    "readable",
    "readable",
    "none",
  ]);
};

/** Every agent and tool node of a finished run worked in `worktree`. */
const expectAllIn = (s: Setup, worktree: string) => {
  expect(s.seen.map(seen => seen.node)).toEqual([
    "recon",
    "hunt",
    "critic",
    "report",
  ]);
  expect(s.seen.map(seen => seen.cwd)).toEqual(
    Array.from({ length: s.seen.length }, () => worktree),
  );
  expectSkills(s);
  expect(s.cwds).not.toContain(s.root);
  expect(new Set(s.cwds)).toEqual(new Set([worktree]));
};

describe("an attached project's security audit, to a finish", () => {
  it("passes scan, works only in the worktree, and leaves the checkout alone", async () => {
    const s = audit();
    const done = await s.run("done");
    expect(s.errors).toEqual([]);
    expect(done.result?.status).toBe("succeeded");
    const record = onlyRun(s.store);
    const worktree = rootOf(s.root, record.id);

    expectAllIn(s, worktree);
    // scan, ledger, consolidate, findings, finalize, write.
    expect(s.cwds).toHaveLength(6);

    expect(existsSync(worktree)).toBe(false);
    expect(rootActions(s.store, record.id)).toEqual(["created", "removed"]);
    expect(checkoutNow(s.root)).toEqual(s.before);
    expect(checkoutNow(s.root).orkThere).toBe(false);
    // The audit is kept: it lives under the audit home, not the worktree.
    expect(existsSync(path.join(auditFolder(s, record.id), "REPORT.md"))).toBe(
      true,
    );
  });

  it("names the audited commit and that uncommitted changes are not audited", async () => {
    const s = audit({ dirty: true });
    await s.run("done");
    const text = reportOf(s, onlyRun(s.store).id);
    expect(text).toContain(
      `audited commit ${headOf(s.root)} (a per-run copy of HEAD)`,
    );
    expect(text).toContain(
      "uncommitted changes in your checkout are not audited",
    );
  });

  it("names the audited commit and no uncommitted changes for a clean checkout", async () => {
    const s = audit({ dirty: false });
    await s.run("done");
    const text = reportOf(s, onlyRun(s.store).id);
    expect(text).toContain(
      `audited commit ${headOf(s.root)} (a per-run copy of HEAD)`,
    );
    expect(text).not.toContain("are not audited");
  });

  it("removes the worktree and the report when the gate discards", async () => {
    const s = audit();
    const done = await s.run("discard");
    expect(done.result?.status).toBe("succeeded");
    const record = onlyRun(s.store);
    // The `discard` node ran too, in the worktree.
    expect(s.cwds).toHaveLength(7);
    expect(new Set(s.cwds)).toEqual(new Set([rootOf(s.root, record.id)]));
    expect(existsSync(auditFolder(s, record.id))).toBe(false);
    expect(existsSync(rootOf(s.root, record.id))).toBe(false);
    expect(checkoutNow(s.root)).toEqual(s.before);
  });

  it("re-creates the worktree on resume at the recorded commit, and finishes there", async () => {
    const s = audit();
    s.failRecon.on = true;
    const first = await s.run("done");
    expect(first.result?.status).toBe("failed");
    const record = onlyRun(s.store);
    const worktree = rootOf(s.root, record.id);
    const head = headOf(s.root);
    expect(existsSync(worktree)).toBe(false);

    // HEAD moves on, and the first try is fixed: the resume audits the first.
    commit(s.root, "later");
    s.failRecon.on = false;
    s.seen.length = 0;
    s.cwds.length = 0;
    const again = await s.run("done", {
      runId: record.id,
      resume: readyToResume(s.store, record),
    });
    expect(again.result?.status).toBe("succeeded");
    expect(s.seen.map(seen => [seen.node, seen.head])).toEqual(
      ["recon", "hunt", "critic", "report"].map(node => [node, head]),
    );
    expect(s.seen.map(seen => seen.cwd)).toEqual(
      Array.from({ length: s.seen.length }, () => worktree),
    );
    expectSkills(s);
    expect(s.cwds).not.toContain(s.root);
    expect(rootActions(s.store, record.id)).toEqual([
      "created",
      "removed",
      "created",
      "removed",
    ]);
    expect(existsSync(worktree)).toBe(false);
    expect(worktreesOf(s.root)).toEqual([s.root]);
    expect(reportOf(s, record.id)).toContain(`audited commit ${head} `);
    expect(checkoutNow(s.root).orkThere).toBe(false);
  });
});

describe("an in-repo security audit, to a finish", () => {
  it("has no run worktree and no audited-commit lines", async () => {
    const s = audit({ attachedProject: false });
    const done = await s.run("done");
    expect(done.result?.status).toBe("succeeded");
    const record = onlyRun(s.store);
    expect(rootActions(s.store, record.id)).toEqual([]);
    expect(worktreesOf(s.root)).toEqual([s.root]);
    expect(new Set(s.cwds)).toEqual(new Set([s.root]));
    expect(new Set(s.seen.map(seen => seen.cwd))).toEqual(new Set([s.root]));
    const text = reportOf(s, record.id);
    expect(text).not.toContain("audited commit");
    expect(text).not.toContain("are not audited");
  });
});
