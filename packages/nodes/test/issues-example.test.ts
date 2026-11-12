/**
 * @file Runs the `issues` example for real against a bare remote, with a fake
 *   `gh` and fake sessions (the builders, reviewers and resolver); its tool
 *   steps are the shipped scripts. Issues by numbers and by label are built and
 *   integrated one at a time into one branch and one pull request that closes
 *   them, an issue whose builder failed or whose review didn't pass is left out
 *   and unlabelled, a conflict goes through the resolver (and a changed
 *   behaviour through the question), and a second run adds to the same pull
 *   request. `list` refuses what it can't work with before it labels anything.
 */

import { compileWorkflow } from "@krapht/ork-core";
import { serializeWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allInProgress,
  body,
  git,
  ghLog,
  ONE,
  open,
  outputOf,
  parsedOrThrow,
  run,
  stderrOf,
  subjects,
  TEXT,
  TWO,
  world,
} from "./issues-world.ts";

describe("the issues example", () => {
  it("is in canonical form and checks with no finding", () => {
    expect(serializeWorkflow(parsedOrThrow())).toBe(TEXT);
    expect(compileWorkflow(parsedOrThrow()).diagnostics).toEqual([]);
  });
});

describe("working issues in parallel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("integrates issues named by number into one branch and one pull request", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, events } = await run(
      w,
      { builds: { 1: ONE, 2: TWO } },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
    expect(outputOf(result, "integrated")).toBe("#1\n#2\n");
    const log = ghLog(w);
    expect(log).toContain("issue edit 1 --add-label in-progress");
    expect(log).toContain("issue edit 2 --remove-label in-progress");
    expect(log.filter(line => line.startsWith("pr create"))).toHaveLength(1);
    // One hold on the branch's lock, from the first integration to the end.
    const taken = events.filter(event => event.type === "lock.taken");
    expect(taken.length).toBeGreaterThan(0);
    const released = events.filter(event => event.type === "lock.released");
    expect(released).toHaveLength(1);
  });

  it("does not start the resolver, or take the lock, when `prepare` fails", async () => {
    const w = world();
    open(w, 1);
    const { result, ran, events } = await run(
      w,
      { builds: { 1: ONE }, prepareFails: true },
      { issues: "1" },
    );
    expect(result.status).toBe("failed");
    expect(ran).toContain("prepare");
    for (const id of ["resolve", "inspect", "check", "push"]) {
      expect(ran).not.toContain(id);
    }
    expect(events.filter(event => event.type === "lock.taken")).toEqual([]);
    expect(ghLog(w)).toContain("issue edit 1 --remove-label in-progress");
  });

  it("takes the open issues of a label that no run has taken", async () => {
    const w = world();
    open(w, 1, 2);
    const { result } = await run(
      w,
      { builds: { 1: ONE, 2: TWO } },
      { label: "ready" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(ghLog(w)).toContain(
      'issue list --label ready --search -label:in-progress --state open --limit 10 --json number,title,body --jq [.[] | {number, title, body: ((.body // "")[:4000])}]',
    );
    expect(body(w)).toContain("Closes #1\nCloses #2");
  });

  it("takes an issue named by number without listing, whatever labels it has", async () => {
    const w = world();
    open(w, 1);
    allInProgress(w);
    const { result } = await run(w, { builds: { 1: ONE } }, { issues: "1" });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    const log = ghLog(w);
    expect(log.filter(line => line.startsWith("issue list"))).toEqual([]);
    expect(log.filter(line => line.startsWith("issue view 1 "))).toHaveLength(
      1,
    );
    expect(log).toContain("issue edit 1 --add-label in-progress");
  });

  it("takes an issue named with leading zeros or twice once", async () => {
    const w = world();
    open(w, 1);
    const { result, ran } = await run(
      w,
      { builds: { 1: ONE } },
      { issues: "01,1" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(
      ghLog(w).filter(line => line.startsWith("issue view 1 ")),
    ).toHaveLength(1);
    expect(ran.filter(id => id.startsWith("build."))).toHaveLength(1);
  });

  it("refuses 0 as not an issue number, before any gh call", async () => {
    const w = world();
    open(w, 1);
    const { result, events } = await run(
      w,
      { builds: { 1: ONE } },
      { issues: "0" },
    );
    expect(result.status).toBe("failed");
    expect(stderrOf(events, "list")).toContain("'0' is not an issue number.");
    expect(ghLog(w)).toEqual([]);
  });

  it("says when every open issue of the label is already in progress", async () => {
    const w = world();
    open(w, 1, 2);
    allInProgress(w);
    const { result, events } = await run(w, { builds: {} }, { label: "ready" });
    expect(result.status).toBe("failed");
    expect(stderrOf(events, "list")).toContain(
      "All 2 open issues labelled ready are already in progress",
    );
    expect(stderrOf(events, "list")).toContain("--input issues=");
    expect(ghLog(w).filter(line => line.startsWith("issue edit"))).toEqual([]);
  });

  it("keeps the plain message for a label with no open issue", async () => {
    const w = world();
    open(w);
    const { result, events } = await run(w, { builds: {} }, { label: "ready" });
    expect(result.status).toBe("failed");
    expect(stderrOf(events, "list")).toContain("No open issue found.");
  });

  it("leaves out an issue whose builder failed or whose review didn't pass, unlabelled and named", async () => {
    const w = world();
    open(w, 1, 2, 3);
    const { result } = await run(
      w,
      {
        builds: { 1: ONE, 2: "fail", 3: { file: "three.txt", text: "3\n" } },
        rejected: [3],
      },
      { issues: "1,2,3" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(subjects(w)).toEqual(["Resolve #1: Issue 1", "base"]);
    expect(body(w)).toContain("Closes #1");
    expect(body(w)).not.toContain("#2");
    expect(body(w)).not.toContain("#3");
    expect(outputOf(result, "leftOut")).toContain("#2: its builder failed");
    expect(outputOf(result, "leftOut")).toContain(
      "#3: the review did not pass it: misses a case",
    );
    expect(ghLog(w)).toContain("issue edit 2 --remove-label in-progress");
    expect(ghLog(w)).toContain("issue edit 3 --remove-label in-progress");
  });

  it("adds a second run's issues to the same pull request", async () => {
    const w = world();
    open(w, 1, 2);
    await run(w, { builds: { 1: ONE } }, { issues: "1" });
    const second = await run(w, { builds: { 2: TWO } }, { issues: "2" });
    expect(second.result.reasons).toEqual([]);
    expect(second.result.status).toBe("succeeded");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
    const log = ghLog(w);
    expect(log.filter(line => line.startsWith("pr create"))).toHaveLength(1);
    expect(log.filter(line => line.startsWith("pr edit"))).toHaveLength(1);
  });

  it("resolves a conflict with the resolver, with no question for a clean merge", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, ran, asked } = await run(
      w,
      {
        builds: {
          1: { file: "app.txt", text: "base\none\n" },
          2: { file: "app.txt", text: "base\ntwo\n" },
        },
        resolution: { text: "base\none\ntwo\n", behaviour: "unchanged" },
      },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(ran).toContain("resolve");
    expect(ran).not.toContain("drop");
    expect(git(w.remote, "show", "feature:app.txt")).toBe("base\none\ntwo\n");
    expect(subjects(w)).toEqual([
      "Resolve #2: Issue 2",
      "Resolve #1: Issue 1",
      "base",
    ]);
    expect(body(w)).toContain("Closes #1\nCloses #2");
  });

  it("asks when the resolution changes behaviour, and leaves the issue out at `stop`", async () => {
    const w = world();
    open(w, 1, 2);
    const { result, ran, asked } = await run(
      w,
      {
        builds: {
          1: { file: "app.txt", text: "limit = 20\n" },
          2: { file: "app.txt", text: "limit = 30\n" },
        },
        resolution: { text: "limit = 25\n", behaviour: "changed" },
        answer: "stop",
      },
      { issues: "1,2" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("#2");
    expect(asked[0]).toContain("+limit = 25");
    expect(ran).toContain("drop");
    expect(subjects(w)).toEqual(["Resolve #1: Issue 1", "base"]);
    expect(outputOf(result, "leftOut")).toContain("#2: its integration failed");
    expect(body(w)).not.toContain("#2");
  });
});

describe("`list` refuses what the run can't work with, before it labels anything", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses more than 10 issues, asks nothing and edits no issue", async () => {
    const w = world();
    const numbers = Array.from({ length: 11 }, (_, index) => index + 1);
    open(w, ...numbers);
    const { result, ran, asked, events } = await run(
      w,
      { builds: {} },
      { issues: numbers.join(",") },
    );
    expect(result.status).toBe("failed");
    expect(ran).not.toContain("mark");
    expect(asked).toEqual([]);
    expect(stderrOf(events, "list")).toContain(
      "11 issues named; a run takes at most 10 (each costs a builder and a reviewer). Name 10 or fewer, and run again for the rest.",
    );
    expect(ghLog(w).filter(line => line.startsWith("issue edit"))).toEqual([]);
  });

  it("takes an issue named twice once", async () => {
    const w = world();
    open(w, 1);
    const { result, ran } = await run(
      w,
      { builds: { 1: ONE } },
      { issues: "1,1" },
    );
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    const log = ghLog(w);
    expect(
      log.filter(line => line.startsWith("issue edit 1 --add-label")),
    ).toHaveLength(1);
    expect(log.filter(line => line.startsWith("issue view 1"))).toHaveLength(1);
    expect(ran.filter(id => id.startsWith("build."))).toHaveLength(1);
  });

  it("counts the distinct numbers, so 10 with a repeat still go through", async () => {
    const w = world();
    const numbers = Array.from({ length: 10 }, (_, index) => index + 1);
    open(w, ...numbers);
    const { events } = await run(
      w,
      { builds: { 1: ONE } },
      { issues: `${numbers.join(",")},1` },
    );
    expect(stderrOf(events, "list")).toBe("");
    expect(
      ghLog(w).filter(line => line.includes("--add-label in-progress")),
    ).toHaveLength(10);
  });

  it("refuses a checkout with no origin, before any gh call", async () => {
    const w = world({ noOrigin: true });
    open(w, 1);
    const { result, events } = await run(
      w,
      { builds: { 1: ONE } },
      { issues: "1" },
    );
    expect(result.status).toBe("failed");
    expect(stderrOf(events, "list")).toContain(
      "issues needs a commit and a remote named origin",
    );
    expect(ghLog(w)).toEqual([]);
  });

  it("refuses a checkout with no commit, before any gh call", async () => {
    const w = world({ noCommit: true });
    open(w, 1);
    const { result, events } = await run(
      w,
      { builds: { 1: ONE } },
      { label: "ready" },
    );
    expect(result.status).toBe("failed");
    expect(stderrOf(events, "list")).toContain(
      "issues needs a commit and a remote named origin",
    );
    expect(ghLog(w)).toEqual([]);
  });
});
