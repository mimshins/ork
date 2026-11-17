/**
 * @file End-to-end tests of `ork onboard` in a real git repository, on each of
 *   the three drivers with a scripted session in place of the model: survey,
 *   answers, preview, propose, filter, pick, write, finish, gate, keep, and a
 *   branch that holds a canonical, valid workflow; then the second run is a
 *   review. Also discarding, picking none, a writer that never satisfies
 *   `finish` (the run ends failed and says why), and that the paid part leaves
 *   the working tree's `.ork/` alone until the person keeps the branch. The
 *   tool nodes run the real `ork __onboard format` from source in the first
 *   test of each driver and where `finish` cannot start; the other tests run
 *   the verbs in this process (`inProcess`).
 */

import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  branches,
  type Case,
  canonical,
  DRIVERS,
  git,
  keptBranch,
  onboard,
  orkFiles,
  repositoryWithLocalFiles,
  runIdOf,
  SCRIPT,
  startedOf,
  SUGGESTION,
  treeOf,
  UNCAPPED,
  WORKFLOW_FILE,
  WRITTEN,
} from "./fixtures/onboard.ts";

/**
 * `onboard` with both `__onboard` verbs run in this process: each CLI start
 * burns CPU a loaded machine does not give. The first test of each driver runs
 * the real `ork format` through `ORK_BIN` (`finish` in-process: the real one
 * checks the machine's drivers); the test where `finish` cannot start runs both
 * real.
 */
const fast = (c: Case) => onboard({ ...c, inProcess: ["format", "finish"] });

/** What the preview says: dollars and tokens, or tokens only with no dollars. */
const PREVIEW = {
  "claude-code": "The most this can spend: $",
  "open-code": "The most this can spend: $",
  "command-code": "reports no dollars, so only the token caps hold",
} as const;

describe.each(DRIVERS)("ork onboard on %s", driver => {
  it("goes from survey to a kept branch holding a canonical, valid workflow", async () => {
    const flow = await onboard({
      driver,
      script: SCRIPT,
      inProcess: ["finish"],
    });
    // The init step's files are uncommitted, and the run says the worktree lacks them.
    expect(flow.err).toMatch(
      /^warning \d+ uncommitted change\(s\) in this checkout are not in the worktrees\n$/u,
    );
    expect(flow.code).toBe(0);
    for (const line of [
      "What Ork read of this project:",
      "Mode: first visit",
      "The most this can spend: ",
      "▸ proposing workflows",
      "1. check-on-change",
      "▸ writing 1 workflow(s)",
      "Ork never merges it",
      "Feedback items your suggestions cited (still open, not resolved): fb-1234",
      "Commit the .gitignore change",
    ]) {
      expect(flow.out).toContain(line);
    }
    const branch = keptBranch(flow.root);
    const text = git(flow.root, "show", `${branch}:${WORKFLOW_FILE}`);
    expect(`${text}\n`).toBe(canonical(WRITTEN));
    expect(text).not.toBe(WRITTEN.trim());
    expect(parseWorkflow(text).ok).toBe(true);
    expect(git(flow.root, "diff", "--name-only", `main...${branch}`)).toBe(
      WORKFLOW_FILE,
    );
  });

  it("holds each session to what its built-in names, on this driver", async () => {
    const flow = await fast({ driver, script: SCRIPT });
    const only = (node: string) =>
      flow.specs.find(spec => spec.nodeId === node)?.tools.only;
    expect(only("propose")).toEqual(["Read"]);
    expect(only("write")).toEqual(["Read", "Edit", "Write"]);
    const propose = flow.specs.find(spec => spec.nodeId === "propose");
    expect(propose?.prompt).toContain("slow tests");
    expect(
      flow.store
        .runs()
        .map(run => run.workflow)
        .toSorted(),
    ).toEqual(["ork-onboard-propose", "ork-onboard-write"]);
  });

  it("words the preview by whether the driver reports dollars", async () => {
    const { out } = await fast({ driver, script: SCRIPT });
    expect(out).toContain(PREVIEW[driver]);
  });

  it("tells the writer the files `ork init` made are not in its worktree", async () => {
    const { store } = await fast({ driver, script: SCRIPT });
    const survey = String(
      startedOf(store, "ork-onboard-write").inputs["survey"],
    );
    expect(survey).toContain("Not in your worktree:");
    expect(survey).toContain("hello.ork.yaml");
    expect(survey).toContain(".gitignore");
  });

  it("starts each built-in with every input marked untrusted", async () => {
    const { store } = await fast({ driver, script: SCRIPT });
    expect(startedOf(store, "ork-onboard-propose").untrusted).toEqual([
      "survey",
      "answers",
      "history",
    ]);
    expect(startedOf(store, "ork-onboard-write").untrusted).toEqual([
      "picks",
      "survey",
      "answers",
    ]);
  });

  it("shows the gate the diff and says the writer is not in a sandbox", async () => {
    const flow = await fast({ driver, script: SCRIPT });
    expect(flow.gate).toHaveLength(1);
    const [gate = ""] = flow.gate;
    expect(gate).toContain("check-on-change.ork.yaml");
    expect(gate).toContain("by a check on its worktree, not by a sandbox");
    expect(gate).toContain("needs your eye");
  });

  it("is a review the second time, once the branch is merged and its workflow has run", async () => {
    const first = await fast({ driver, script: SCRIPT });
    const { root, store } = first;
    git(root, "merge", "-q", "--no-edit", keptBranch(root));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "keep");
    // Onboarding's own runs are left out of a review; the person's workflow ran.
    store.begin({
      id: "own-run",
      workflow: "check-on-change",
      file: path.join(root, WORKFLOW_FILE),
      project: root,
    });
    const second = await fast({
      driver,
      script: SCRIPT,
      root,
      store,
      answers: ["slow tests", "weekly", "a PR", "n"],
    });
    expect(second.code).toBe(0);
    expect(second.out).toContain("Mode: review (2 workflows, 1 runs)");
    expect(second.out).toContain("Nothing started, nothing written.");
  });

  it("gives the proposer the digest of past runs on a review", async () => {
    const first = await fast({ driver, script: SCRIPT });
    const { root, store } = first;
    git(root, "merge", "-q", "--no-edit", keptBranch(root));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "keep");
    store.begin({
      id: "own-run",
      workflow: "check-on-change",
      file: path.join(root, WORKFLOW_FILE),
      project: root,
    });
    await fast({
      driver,
      script: SCRIPT,
      root,
      store,
      // Start, then pick none: the propose run is the one looked at.
      answers: ["slow tests", "weekly", "a PR", "y", ""],
    });
    const { inputs } = startedOf(store, "ork-onboard-propose");
    expect(String(inputs["history"])).toContain("check-on-change");
  });
});

const secondSurvey = async (commit: boolean): Promise<string> => {
  const first = await fast({
    driver: "claude-code",
    script: SCRIPT,
    gate: "discard",
  });
  if (commit) {
    git(first.root, "add", "-A");
    git(first.root, "commit", "-q", "-m", "keep .ork");
  }
  const second = await fast({
    driver: "claude-code",
    script: SCRIPT,
    root: first.root,
  });
  expect(second.code).toBe(0);
  return String(startedOf(second.store, "ork-onboard-write").inputs["survey"]);
};

describe("ork onboard, the writer's note about uncommitted files", () => {
  it("is not sent when .ork/ was there and is committed", async () => {
    const survey = await secondSurvey(true);
    expect(survey).toContain(".ork/:");
    expect(survey).not.toContain("Not in your worktree");
  });

  it("names the files of .ork/ and .gitignore that are still uncommitted", async () => {
    const survey = await secondSurvey(false);
    expect(survey).toContain("Not in your worktree");
    expect(survey).toContain(".ork/workflows/hello.ork.yaml");
  });
});

describe("ork onboard, the ways it ends", () => {
  it("discards the change: the branch and the worktree are gone", async () => {
    const flow = await fast({
      driver: "claude-code",
      script: SCRIPT,
      gate: "discard",
    });
    expect(flow.code).toBe(0);
    expect(flow.out).toContain("discarded the change; nothing was kept");
    expect(branches(flow.root)).toEqual([]);
    expect(git(flow.root, "worktree", "list").split("\n")).toHaveLength(1);
  });

  it("writes nothing when no suggestion is picked, and the propose run stays", async () => {
    const flow = await fast({
      driver: "open-code",
      script: SCRIPT,
      answers: ["a", "b", "c", "y", ""],
    });
    expect(flow.code).toBe(0);
    expect(flow.out).toContain("Nothing picked; nothing written.");
    expect(flow.store.runs().map(run => run.workflow)).toEqual([
      "ork-onboard-propose",
    ]);
    expect(branches(flow.root)).toEqual([]);
    expect(flow.gate).toEqual([]);
  });

  it("writes nothing when every suggestion cites a file that is not there", async () => {
    const missing = {
      ...SUGGESTION,
      evidence: [{ path: "docs/nowhere.md" }],
    };
    const flow = await fast({
      driver: "command-code",
      script: { ...SCRIPT, suggestions: [missing] },
    });
    expect(flow.code).toBe(0);
    expect(flow.out).toContain("dropped check-on-change");
    expect(flow.out).toContain(
      "Nothing to write: no suggestion survived the checks.",
    );
    expect(flow.store.runs()).toHaveLength(1);
  });

  it("sends problems back to the writer, then fails the run and says what and which run", async () => {
    const flow = await fast({
      driver: "claude-code",
      script: { ...SCRIPT, rounds: [{ [WORKFLOW_FILE]: UNCAPPED }] },
    });
    expect(flow.code).toBe(1);
    // The first go, then the three rounds `finish` sends it back for.
    const writes = flow.specs.filter(spec => spec.nodeId === "write");
    expect(writes).toHaveLength(4);
    const id = runIdOf(flow.store, "ork-onboard-write");
    expect(flow.err).toContain(`run ${id}`);
    expect(flow.err).toContain("What the check last found, after 3 rounds:");
    expect(flow.err).toContain("budgetUsd");
    // Only the loop's own question: the keep gate is never reached.
    expect(flow.gate).toEqual([
      "The loop finish -> write used all 3 of its rounds. What now?",
    ]);
    expect(flow.out).not.toContain("kept the workflows");
    // The failed run's worktree and branch stay, for `ork resume`.
    expect(branches(flow.root)).toHaveLength(1);
  });

  it("does not send the writer back when `finish` cannot start, and says why", async () => {
    const flow = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      missing: "finish",
    });
    expect(flow.code).toBe(1);
    expect(flow.specs.filter(spec => spec.nodeId === "write")).toHaveLength(1);
    expect(flow.err).toContain("finish: sh exited with 127");
    expect(flow.err).not.toContain("after 3 rounds");
    expect(flow.out).not.toContain("kept the workflows");
  });

  it("keeps the branch when the project has gitignored local agent files Ork copies into the worktree", async () => {
    const flow = await fast({
      driver: "claude-code",
      script: SCRIPT,
      root: repositoryWithLocalFiles(),
    });
    expect(flow.code).toBe(0);
    expect(flow.specs.filter(spec => spec.nodeId === "write")).toHaveLength(1);
    expect(keptBranch(flow.root)).toContain("ork/");
  });

  it("filters a suggestions list of 300 KB without failing the run", async () => {
    const huge = { ...SUGGESTION, workflow: "big", why: "x".repeat(300_000) };
    const flow = await fast({
      driver: "claude-code",
      script: { ...SCRIPT, suggestions: [SUGGESTION, huge] },
    });
    expect(flow.code).toBe(0);
    expect(flow.out).toContain("dropped big");
    expect(keptBranch(flow.root)).toContain("ork/");
  });

  it("takes a second round that fixes what the first got wrong", async () => {
    const flow = await fast({
      driver: "claude-code",
      script: {
        ...SCRIPT,
        rounds: [{ [WORKFLOW_FILE]: UNCAPPED }, { [WORKFLOW_FILE]: WRITTEN }],
      },
    });
    expect(flow.code).toBe(0);
    expect(flow.specs.filter(spec => spec.nodeId === "write")).toHaveLength(2);
    expect(branches(flow.root)).toHaveLength(1);
  });
});

describe("the paid part and the working tree", () => {
  it("leaves every .ork/ file as it was from the preview to the gate, and after a discard", async () => {
    const flow = await fast({
      driver: "claude-code",
      script: SCRIPT,
      gate: "discard",
    });
    expect(flow.trees.start).toHaveLength(1);
    expect(flow.trees.gate).toEqual(flow.trees.start);
    expect(treeOf(flow.root)).toBe(flow.trees.start[0]);
    expect(orkFiles(flow.root)).not.toHaveProperty([WORKFLOW_FILE]);
  });

  it("changes the working tree's .ork/ not at all when the branch is kept", async () => {
    const flow = await fast({ driver: "claude-code", script: SCRIPT });
    expect(treeOf(flow.root)).toBe(flow.trees.start[0]);
    expect(Object.keys(orkFiles(flow.root))).toEqual([
      ".ork/workflows/hello.ork.yaml",
    ]);
  });
});
