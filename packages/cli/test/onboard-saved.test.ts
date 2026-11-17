/**
 * @file Tests for the proposal `ork onboard` leaves at the pick: which stored
 *   run is offered (the newest succeeded propose run of this project that no
 *   write run followed, nobody else's), what is said on Ctrl-C at the pick, and
 *   that a next `ork onboard` takes the proposal without the questions or a
 *   second paid propose run, or starts as before on "no" and `--fresh`; and
 *   that an unfinished propose run, when it is the newest, is offered and
 *   resumed under its own id instead.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type EventStore, openStore, type RunStatus } from "@krapht/ork-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as PickModule from "../src/onboard/pick.ts";
import { pickSuggestions } from "../src/onboard/pick.ts";
import { interruptedLines, spentLine } from "../src/onboard/runs.ts";
import {
  findSavedProposal,
  findUnfinishedPropose,
} from "../src/onboard/saved.ts";
import type * as ConfirmModule from "../src/term/confirm.ts";
import { confirmOrStop } from "../src/term/confirm.ts";
import {
  branches,
  git,
  keptBranch,
  onboard,
  runIdOf,
  SCRIPT,
  startedOf,
} from "./fixtures/onboard.ts";

vi.mock("../src/onboard/pick.ts", async importActual => {
  const actual = await importActual<typeof PickModule>();
  return {
    ...actual,
    pickSuggestions: vi.fn<typeof actual.pickSuggestions>(
      actual.pickSuggestions,
    ),
  };
});

vi.mock("../src/term/confirm.ts", async importActual => {
  const actual = await importActual<typeof ConfirmModule>();
  return {
    ...actual,
    confirmOrStop: vi.fn<typeof actual.confirmOrStop>(actual.confirmOrStop),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const suggestion = {
  workflow: "triage",
  why: "Issues pile up.",
  decidedBy: "you, at the gate",
  caps: { budgetUsd: 2, budgetTokens: 400000 },
  evidence: [{ path: "README.md" }],
};

/** A project folder holding `README.md`, the one file the evidence cites. */
const project = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-saved-"));
  writeFileSync(path.join(root, "README.md"), "# App\n");
  return root;
};

type Recorded = {
  at?: string;
  status?: RunStatus;
  suggestions?: unknown[];
  survey?: string;
  file?: string;
  /** `false` leaves the run running, in this live process. */
  finished?: false;
};

/** Stores a built-in run the way a run leaves it: started, then finished. */
const record = (
  store: EventStore,
  id: string,
  workflow: string,
  root: string,
  o: Recorded = {},
): void => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(o.at ?? "2026-11-16T10:00:00Z"));
  store.begin({
    id,
    workflow,
    file: o.file ?? `${root}/.ork/runs/.builtin/abc123/${workflow}.ork.yaml`,
    project: root,
  });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow,
    entries: [],
    nodes: [],
    inputs: { survey: o.survey ?? "the survey", answers: "Q: x\nA: y" },
  });
  if (o.finished === false) return;
  store.append(id, {
    type: "run.finished",
    result: {
      runId: id,
      status: o.status ?? "succeeded",
      costUsd: 0,
      nodes: [
        {
          id: "propose",
          runs: 1,
          ok: true,
          output: { suggestions: o.suggestions ?? [suggestion] },
          costUsd: 0,
        },
      ],
      reasons: [],
      worktrees: [],
    },
  });
};

describe("findSavedProposal", () => {
  it("finds the proposal with its survey, answers and run", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "p1", "ork-onboard-propose", root);
    const saved = findSavedProposal(store, root);
    expect(saved?.run.id).toBe("p1");
    expect(saved?.at).toBe("2026-11-16T10:00:00.000Z");
    expect(saved?.survey).toBe("the survey");
    expect(saved?.answers).toBe("Q: x\nA: y");
    expect(saved?.proposed.kept.map(s => s.workflow)).toEqual(["triage"]);
  });

  it("is none for a store with no propose run", () => {
    const root = project();
    const store = openStore(":memory:");
    expect(findSavedProposal(store, root)).toBeNull();
    record(store, "own", "build", root, { file: `${root}/.ork/w.ork.yaml` });
    expect(findSavedProposal(store, root)).toBeNull();
  });

  it("takes the newest propose run: succeeded it is saved, unfinished it is not", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "old", "ork-onboard-propose", root, {
      at: "2026-11-15T10:00:00Z",
    });
    record(store, "new", "ork-onboard-propose", root, {
      at: "2026-11-16T10:00:00Z",
    });
    expect(findSavedProposal(store, root)?.run.id).toBe("new");
    record(store, "bad", "ork-onboard-propose", root, {
      at: "2026-11-16T11:00:00Z",
      status: "failed",
    });
    expect(findSavedProposal(store, root)).toBeNull();
  });

  it("is none once a write run followed it, and back for a later propose run", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "p1", "ork-onboard-propose", root);
    record(store, "w1", "ork-onboard-write", root, {
      at: "2026-11-16T10:30:00Z",
    });
    expect(findSavedProposal(store, root)).toBeNull();
    record(store, "p2", "ork-onboard-propose", root, {
      at: "2026-11-16T12:00:00Z",
    });
    expect(findSavedProposal(store, root)?.run.id).toBe("p2");
  });

  it("does not offer another project's run, or a user's own workflow of that name", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "theirs", "ork-onboard-propose", project());
    record(store, "mine", "ork-onboard-propose", root, {
      file: `${root}/.ork/workflows/ork-onboard-propose.ork.yaml`,
    });
    expect(findSavedProposal(store, root)).toBeNull();
  });

  it("drops a suggestion that cites a file that is gone, and is none when all are", () => {
    const root = project();
    const store = openStore(":memory:");
    const gone = { ...suggestion, workflow: "gone", evidence: [{ path: "x" }] };
    record(store, "p1", "ork-onboard-propose", root, {
      suggestions: [suggestion, gone],
    });
    const saved = findSavedProposal(store, root);
    expect(saved?.proposed.kept.map(s => s.workflow)).toEqual(["triage"]);
    expect(saved?.proposed.dropped.map(d => d.workflow)).toEqual(["gone"]);
    rmSync(path.join(root, "README.md"));
    expect(findSavedProposal(store, root)).toBeNull();
  });

  it("is none when the run's inputs are not text", () => {
    const root = project();
    const store = openStore(":memory:");
    store.begin({
      id: "p1",
      workflow: "ork-onboard-propose",
      file: `${root}/.ork/runs/.builtin/abc123/p.ork.yaml`,
      project: root,
    });
    store.append("p1", {
      type: "run.started",
      runId: "p1",
      workflow: "ork-onboard-propose",
      entries: [],
      nodes: [],
      inputs: { survey: 1 },
    });
    expect(findSavedProposal(store, root)).toBeNull();
  });
});

describe("findUnfinishedPropose", () => {
  it("finds the newest propose run that did not succeed, with its stored inputs", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "old", "ork-onboard-propose", root, {
      at: "2026-11-15T10:00:00Z",
    });
    record(store, "bad", "ork-onboard-propose", root, {
      at: "2026-11-16T11:00:00Z",
      status: "failed",
    });
    const unfinished = findUnfinishedPropose(store, root);
    expect(unfinished?.run.id).toBe("bad");
    expect(unfinished?.status).toBe("failed");
    expect(unfinished?.at).toBe("2026-11-16T11:00:00.000Z");
    expect(unfinished?.survey).toBe("the survey");
    expect(unfinished?.answers).toBe("Q: x\nA: y");
    expect(unfinished?.resume.succeeded).toBe(false);
  });

  it("is none when the newest propose run succeeded, even after an older one failed", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "bad", "ork-onboard-propose", root, {
      at: "2026-11-15T10:00:00Z",
      status: "failed",
    });
    record(store, "good", "ork-onboard-propose", root, {
      at: "2026-11-16T10:00:00Z",
    });
    expect(findUnfinishedPropose(store, root)).toBeNull();
    expect(findSavedProposal(store, root)?.run.id).toBe("good");
  });

  it("is none for a run that used its budget, and nothing older is offered", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "good", "ork-onboard-propose", root, {
      at: "2026-11-15T10:00:00Z",
    });
    record(store, "spent", "ork-onboard-propose", root, {
      at: "2026-11-16T10:00:00Z",
      status: "budget_exhausted",
    });
    expect(findUnfinishedPropose(store, root)).toBeNull();
    expect(findSavedProposal(store, root)).toBeNull();
  });

  it("finds a run whose process is gone, as crashed", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "dead", "ork-onboard-propose", root, { finished: false });
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone;
    });
    const unfinished = findUnfinishedPropose(store, root);
    kill.mockRestore();
    expect(unfinished?.run.id).toBe("dead");
    expect(unfinished?.status).toBe("crashed");
  });

  it("is none for a run still running", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "live", "ork-onboard-propose", root, { finished: false });
    expect(findUnfinishedPropose(store, root)).toBeNull();
  });

  it("is none once a write run followed it", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "bad", "ork-onboard-propose", root, { status: "failed" });
    record(store, "w1", "ork-onboard-write", root, {
      at: "2026-11-16T10:30:00Z",
    });
    expect(findUnfinishedPropose(store, root)).toBeNull();
  });

  it("is none for another project's run, or a user's own workflow of that name", () => {
    const root = project();
    const store = openStore(":memory:");
    record(store, "theirs", "ork-onboard-propose", project(), {
      status: "failed",
    });
    record(store, "mine", "ork-onboard-propose", root, {
      status: "failed",
      file: `${root}/.ork/workflows/ork-onboard-propose.ork.yaml`,
    });
    expect(findUnfinishedPropose(store, root)).toBeNull();
  });
});

describe("what a run spent", () => {
  it("shows dollars and tokens on a priced driver", () => {
    expect(spentLine({ costUsd: 0.0312, tokens: 12_300 })).toBe(
      "$0.0312 · 12.3k tokens",
    );
    expect(spentLine({ costUsd: 0.5 })).toBe("$0.5000");
  });

  it("shows tokens alone on a driver that reports no dollars", () => {
    expect(spentLine({ costUsd: 0, tokens: 3000, partial: true })).toBe(
      "3.0k tokens",
    );
    expect(spentLine({ costUsd: 0 })).toBe("$0.00");
  });

  it("says the run and the way back on Ctrl-C", () => {
    expect(interruptedLines({ id: "r1", spent: "3.0k tokens" })).toEqual([
      "Stopped at the pick. The proposing run r1 spent 3.0k tokens.",
      "Run `ork onboard` again to pick from it.",
    ]);
  });
});

/** Start, then pick none: the propose run stays and nothing is written. */
const LEAVE = ["a", "b", "c", "y", ""];

const leave = () =>
  onboard({ driver: "claude-code", script: SCRIPT, answers: LEAVE });

describe("ork onboard after a proposal was left at the pick", () => {
  it("offers it, and on yes skips the questions and the paid propose run", async () => {
    const first = await leave();
    const { root, store } = first;
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      answers: ["y", "1"],
    });
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/A proposal from .+ is saved \(run /u);
    expect(second.out).not.toContain("▸ proposing workflows");
    expect(second.specs.map(spec => spec.nodeId)).not.toContain("propose");
    expect(
      store.runs().filter(run => run.workflow === "ork-onboard-propose"),
    ).toHaveLength(1);
    const asked = String(
      startedOf(store, "ork-onboard-propose").inputs["survey"],
    );
    const written = startedOf(store, "ork-onboard-write").inputs;
    // The first run left .ork/ uncommitted, so the writer's note joins it.
    expect(written["survey"]).toContain(asked);
    expect(written["survey"]).toContain("Not in your worktree");
    expect(keptBranch(root)).toContain("ork/");
  });

  it("starts as before on no, with the questions and a new propose run", async () => {
    const first = await leave();
    const { root, store } = first;
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      answers: ["n", ...LEAVE],
    });
    expect(second.out).toContain("▸ proposing workflows");
    expect(
      store.runs().filter(run => run.workflow === "ork-onboard-propose"),
    ).toHaveLength(2);
  });

  it("is not offered with --fresh", async () => {
    const first = await leave();
    const { root, store } = first;
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      fresh: true,
      answers: LEAVE,
    });
    expect(second.out).not.toContain("is saved");
    expect(second.out).toContain("▸ proposing workflows");
  });

  it("is not offered when nothing was proposed before, or after the workflows were written", async () => {
    const none = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      answers: ["a", "b", "c", "n"],
    });
    expect(none.out).not.toContain("is saved");
    const written = await onboard({ driver: "claude-code", script: SCRIPT });
    const again = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root: written.root,
      store: written.store,
      answers: ["a", "b", "c", "n"],
    });
    expect(again.out).not.toContain("is saved");
  });

  it("offers nothing from another project's store records", async () => {
    const first = await leave();
    const other = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      store: first.store,
      answers: ["a", "b", "c", "n"],
    });
    expect(other.out).not.toContain("is saved");
    expect(other.out).toContain("Nothing started, nothing written.");
  });
});

/** The propose session fails, so the propose run ends `failed`. */
const FAILING = { ...SCRIPT, failPropose: true as const };

/** Answers the questions and starts a propose run that fails. */
const failToPropose = () =>
  onboard({
    driver: "claude-code",
    script: FAILING,
    answers: ["a", "b", "c", "y"],
  });

const proposeRuns = (store: EventStore): string[] =>
  store
    .runs()
    .filter(run => run.workflow === "ork-onboard-propose")
    .map(run => run.id);

describe("ork onboard after a proposing run did not finish", () => {
  it("offers it, and on yes resumes that same run, then picks and writes", async () => {
    const first = await failToPropose();
    const { root, store } = first;
    const id = runIdOf(store, "ork-onboard-propose");
    expect(first.code).toBe(1);
    expect(first.err).toContain(`\`ork resume ${id}\``);

    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      answers: ["y", "1"],
    });
    expect(second.code).toBe(0);
    expect(second.out).toMatch(
      new RegExp(`An unfinished proposal from .+ \\(run ${id}, failed\\)`, "u"),
    );
    expect(second.out).not.toContain("is saved");
    expect(proposeRuns(store)).toEqual([id]);
    const asked = startedOf(store, "ork-onboard-propose");
    expect(asked.untrusted).toEqual(["survey", "answers", "history"]);
    expect(
      store
        .events(id)
        .map(({ event }) => event)
        .filter(event => event.type === "run.started")
        .map(event => event.settings?.untrusted),
    ).toEqual([asked.untrusted, asked.untrusted]);
    const written = startedOf(store, "ork-onboard-write").inputs;
    expect(written["survey"]).toContain(String(asked.inputs["survey"]));
    expect(written["answers"]).toBe(String(asked.inputs["answers"]));
    expect(keptBranch(root)).toContain("ork/");
  });

  it("starts as before on no, with the questions and a new propose run", async () => {
    const { root, store } = await failToPropose();
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      answers: ["n", ...LEAVE],
    });
    expect(second.out).toContain("can be resumed");
    expect(second.out).toContain("▸ proposing workflows");
    expect(proposeRuns(store)).toHaveLength(2);
  });

  it("is not offered with --fresh", async () => {
    const { root, store } = await failToPropose();
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      fresh: true,
      answers: LEAVE,
    });
    expect(second.out).not.toContain("can be resumed");
    expect(proposeRuns(store)).toHaveLength(2);
  });

  it("exits 130 on Ctrl-C at the offer, and resumes nothing", async () => {
    const { root, store } = await failToPropose();
    vi.mocked(confirmOrStop).mockResolvedValueOnce(null);
    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
    });
    expect(second.code).toBe(130);
    expect(second.specs).toEqual([]);
  });

  it("stops with the way to resume and exit 1 when the resumed run fails again", async () => {
    const { root, store } = await failToPropose();
    const id = runIdOf(store, "ork-onboard-propose");
    const second = await onboard({
      driver: "claude-code",
      script: FAILING,
      root,
      store,
      answers: ["y"],
    });
    expect(second.code).toBe(1);
    expect(second.err).toContain(`\`ork resume ${id}\``);
    expect(proposeRuns(store)).toEqual([id]);
  });

  it("offers nothing from another project's store records", async () => {
    const first = await failToPropose();
    const other = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      store: first.store,
      answers: ["a", "b", "c", "n"],
    });
    expect(other.out).not.toContain("can be resumed");
    expect(other.out).toContain("Nothing started, nothing written.");
  });
});

describe("ork onboard, Ctrl-C at the pick", () => {
  it("says the run, what it spent and how to come back, exits 130, and the next run picks from it", async () => {
    vi.mocked(pickSuggestions).mockResolvedValueOnce(null);
    const first = await onboard({ driver: "claude-code", script: SCRIPT });
    const { root, store } = first;
    const id = runIdOf(store, "ork-onboard-propose");
    expect(first.code).toBe(130);
    expect(first.err).toContain(`The proposing run ${id} spent `);
    expect(first.err).toContain("Run `ork onboard` again to pick from it.");
    expect(branches(root)).toEqual([]);
    expect(
      store.runs().filter(run => run.workflow === "ork-onboard-write"),
    ).toHaveLength(0);

    const second = await onboard({
      driver: "claude-code",
      script: SCRIPT,
      root,
      store,
      answers: ["y", "1"],
    });
    expect(second.code).toBe(0);
    expect(second.out).toContain(`(run ${id})`);
    expect(git(root, "branch", "--list", "ork/*")).toContain("ork/");
  });
});
