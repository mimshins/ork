/**
 * @file Tests for `ork ps` and `ork logs` run through their real commands
 *   against a store in a throwaway home (RFC-017): `ps` filters by status,
 *   workflow, project and start, keeps its limit of 20, prints `--ids`, and
 *   refuses a bad value; `logs` filters events by time and keeps the last
 *   `--limit` of them.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  openStore,
  placeFor,
  type RunEvent,
  type RunRecord,
  storePath,
} from "@krapht/ork-core";
import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logs, ps } from "../src/commands/runs.ts";
import { followRun } from "../src/runs/logs.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The real now, taken before a test fakes the clock. */
let base = Date.now();
const here = placeFor(process.cwd(), []).root;

type Seed = {
  id: string;
  workflow: string;
  /** How long before now the run started. */
  ago: number;
  status?: "succeeded" | "failed";
  project?: string;
  /** Its process is gone: the live status reads `crashed`. */
  gone?: boolean;
  /** Paused as a whole by `ork pause`. */
  paused?: boolean;
};

type Store = ReturnType<typeof openStore>;

/** The `run.finished` event of run `id`. */
const finishedEvent = (
  id: string,
  status: "succeeded" | "failed",
): RunEvent => ({
  type: "run.finished",
  result: {
    runId: id,
    status,
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

/** Begins `seed` as if `ago` ago, and finishes it unless it has no status. */
const seedRun = (store: Store, seed: Seed): void => {
  vi.setSystemTime(base - seed.ago);
  store.begin({
    id: seed.id,
    workflow: seed.workflow,
    file: "/p/w.ork.yaml",
    project: seed.project ?? here,
  });
  if (seed.status !== undefined) {
    store.append(seed.id, finishedEvent(seed.id, seed.status));
  }
  if (seed.paused === true) {
    store.append(seed.id, { type: "run.command", command: "pause" });
  }
};

/** Gives the runs that are `gone` the id of a process that has exited. */
const endProcesses = (home: string, seeds: readonly Seed[]): void => {
  const db = new DatabaseSync(storePath(home));
  const dead = spawnSync("true").pid;
  for (const { id, gone } of seeds) {
    if (gone === true)
      db.prepare("UPDATE runs SET pid = ? WHERE id = ?").run(dead, id);
  }
  db.close();
};

/** A throwaway home whose store holds `seeds`, oldest listed last. */
const setup = (seeds: readonly Seed[]) => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-ps-")));
  vi.stubEnv("HOME", home);
  vi.stubEnv("ORK_PLAIN", "1");
  const store = openStore(storePath(home));
  base = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const seed of seeds) seedRun(store, seed);
  vi.useRealTimers();
  endProcesses(home, seeds);
  return store;
};

const RUNS: Seed[] = [
  { id: "a1", workflow: "build", ago: 10 * DAY, status: "succeeded" },
  { id: "b2", workflow: "build", ago: 2 * HOUR, status: "failed" },
  { id: "c3", workflow: "lint", ago: HOUR, status: "failed" },
  { id: "d4", workflow: "build", ago: HOUR / 2 },
  {
    id: "z9",
    workflow: "build",
    ago: HOUR / 4,
    status: "succeeded",
    project: "/elsewhere",
  },
];

type Ran = { out: string; err: string; code: number | string | undefined };

/** Runs `ork <command> <args>` and what it printed. */
const ork = async (command: "ps" | "logs", ...args: string[]): Promise<Ran> => {
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(text => {
    out += String(text);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    err += String(text);
    return true;
  });
  process.exitCode = undefined;
  try {
    await (command === "ps"
      ? runCommand(ps, { rawArgs: args })
      : runCommand(logs, { rawArgs: args }));
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  const code = process.exitCode;
  process.exitCode = undefined;
  return { out, err, code };
};

/** The ids `ork ps <args> --ids` prints. */
const ids = async (...args: string[]): Promise<string> =>
  (await ork("ps", ...args, "--ids")).out.trim();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("ork ps", () => {
  it("lists this project's runs newest first, ids on one line", async () => {
    setup(RUNS).close();
    expect(await ids()).toBe("d4,c3,b2,a1");
  });

  it("filters by status, the live one included", async () => {
    setup(RUNS).close();
    expect(await ids("--status", "failed")).toBe("c3,b2");
    expect(await ids("--status", "running")).toBe("d4");
    expect(await ids("--status", "all")).toBe("d4,c3,b2,a1");
  });

  it("lists a live run by its live status: paused and crashed", async () => {
    setup([
      { id: "d4", workflow: "build", ago: HOUR / 2 },
      { id: "g7", workflow: "build", ago: HOUR / 3, gone: true },
      { id: "p8", workflow: "build", ago: HOUR / 6, paused: true },
    ]).close();
    expect(await ids("--status", "crashed")).toBe("g7");
    expect(await ids("--status", "paused")).toBe("p8");
    expect(await ids("--status", "running")).toBe("d4");
    expect(await ids("--status", "all")).toBe("p8,g7,d4");
  });

  it("filters by workflow and by start", async () => {
    setup(RUNS).close();
    expect(await ids("--workflow", "lint")).toBe("c3");
    expect(await ids("--since", "7d")).toBe("d4,c3,b2");
    expect(await ids("--since", "all")).toBe("d4,c3,b2,a1");
    const day = new Date(Date.now() - 5 * DAY).toLocaleDateString("en-CA");
    expect(await ids("--until", day)).toBe("a1");
  });

  it("combines filters, then limits", async () => {
    setup(RUNS).close();
    expect(
      await ids(
        "--status",
        "failed",
        "--workflow",
        "build",
        "--since",
        "7d",
        "--limit",
        "5",
        "--project",
        "all",
      ),
    ).toBe("b2");
    expect(await ids("--limit", "2")).toBe("d4,c3");
  });

  it("takes --project all", async () => {
    setup(RUNS).close();
    expect(await ids("--project", "all")).toBe("z9,d4,c3,b2,a1");
  });

  it("shows nothing for --ids on an empty result", async () => {
    setup(RUNS).close();
    const ran = await ork("ps", "--workflow", "none", "--ids");
    expect(ran).toEqual({ out: "", err: "", code: undefined });
  });

  it("shows only 20 runs unless --limit says more", async () => {
    setup(
      Array.from({ length: 22 }, (_, i) => ({
        id: `r${String(i).padStart(2, "0")}`,
        workflow: "build",
        ago: (22 - i) * 60_000,
        status: "succeeded" as const,
      })),
    ).close();
    expect((await ids()).split(",")).toHaveLength(20);
    expect((await ids("--limit", "21")).split(",")).toHaveLength(21);
  });

  it("prints the stored records as JSON, without a listed status", async () => {
    setup(RUNS).close();
    const { out } = await ork("ps", "--status", "running", "--json");
    expect(JSON.parse(out)).toEqual([expect.objectContaining({ id: "d4" })]);
    expect(out).not.toContain('"listed"');
  });

  it("adds `live` to the JSON rows: the status the table shows, `status` as stored", async () => {
    setup([
      { id: "g7", workflow: "build", ago: HOUR / 3, gone: true },
      { id: "a1", workflow: "build", ago: 2 * HOUR, status: "succeeded" },
    ]).close();
    const rows: unknown = JSON.parse((await ork("ps", "--json")).out);
    expect(rows).toMatchObject([
      { id: "g7", status: "running", live: "crashed" },
      { id: "a1", status: "succeeded", live: "succeeded" },
    ]);
  });

  it("says why a --limit in exponent form is refused", async () => {
    setup(RUNS).close();
    const ran = await ork("ps", "--limit", "1e21");
    expect(ran.err).toContain("written in digits, not `1e21`.");
    expect(ran.code).toBe(1);
  });

  it.each([
    [
      ["--limit", "0"],
      "--limit takes a positive whole number written in digits, not `0`.",
    ],
    [
      ["--limit", "2.5"],
      "--limit takes a positive whole number written in digits, not `2.5`.",
    ],
    [["--since", "soon"], "--since takes"],
    [["--ids", "--json"], "--ids and --json can't be used together."],
    [["--project", "nope"], "No registered project `nope`"],
  ])("refuses %j", async (args, message) => {
    setup(RUNS).close();
    const ran = await ork("ps", ...args);
    expect(ran.err).toContain(message);
    expect(ran.out).toBe("");
    expect(ran.code).toBe(1);
  });
});

/** A run whose events were stored 3 days, 2 days, 1 hour and now ago. */
const seedLogs = (): void => {
  const store = setup([{ id: "L1", workflow: "w", ago: 4 * DAY }]);
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const ago of [3 * DAY, 2 * DAY, HOUR, 0]) {
    vi.setSystemTime(base - ago);
    store.append("L1", {
      type: "worktree",
      id: "n",
      action: "created",
      path: "/w",
    });
  }
  vi.useRealTimers();
  store.close();
};

/** The sequence numbers `ork logs L1 --json <args>` prints. */
const seqs = async (...args: string[]): Promise<number[]> =>
  (await ork("logs", "L1", "--json", ...args)).out
    .trim()
    .split("\n")
    .filter(line => line !== "")
    .map(line => Number(/"seq":(\d+)/u.exec(line)?.[1]));

/** A live run `L1` that stored 4 events; its process is this one. */
const liveRun = (): Store => {
  const store = setup([{ id: "L1", workflow: "w", ago: HOUR }]);
  for (let i = 0; i < 4; i++) {
    store.append("L1", {
      type: "worktree",
      id: "n",
      action: "created",
      path: "/w",
    });
  }
  return store;
};

const runOf = (store: Store): RunRecord => {
  const [run] = store.lookup("L1");
  if (run === undefined) throw new Error("run L1 is not stored");
  return run;
};

const tmpHome = (): string => process.env["HOME"] ?? "";

/** Two more events, then the end: what a follower prints after its replay. */
const finishLater = (store: Store): void => {
  for (let i = 0; i < 2; i++) {
    store.append("L1", {
      type: "worktree",
      id: "n",
      action: "created",
      path: "/w",
    });
  }
  store.append("L1", finishedEvent("L1", "succeeded"));
};

const seqOf = (line: string): number => Number(/"seq":(\d+)/u.exec(line)?.[1]);

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

// Known limit: followRun reads the stored events twice (the replay slice, then
// followEvents), so an event stored between the two reads would print past the
// limit. A test can't time that without a seam, so none does.
describe("ork logs", () => {
  it("filters events by time and keeps the last --limit", async () => {
    seedLogs();
    expect(await seqs()).toEqual([1, 2, 3, 4]);
    expect(await seqs("--since", "24h")).toEqual([3, 4]);
    const day = new Date(Date.now() - 2 * DAY).toLocaleDateString("en-CA");
    expect(await seqs("--until", day)).toEqual([1, 2]);
    expect(await seqs("--limit", "3")).toEqual([2, 3, 4]);
    expect(await seqs("--since", "7d", "--limit", "1")).toEqual([4]);
  });

  it("keeps the last --limit of a live run's stored events, then follows", async () => {
    const store = liveRun();
    const printed: string[] = [];
    const done = followRun(
      store,
      runOf(store),
      line => void printed.push(line),
      {
        follow: true,
        json: true,
        limit: 2,
        intervalMs: 5,
        home: tmpHome(),
      },
    );
    await sleep(30);
    finishLater(store);
    await done;
    expect(printed.map(line => seqOf(line))).toEqual([3, 4, 5, 6, 7]);
    store.close();
  });

  it("does the same through `ork logs --follow --limit`", async () => {
    const store = liveRun();
    const ran = ork("logs", "L1", "--follow", "--json", "--limit", "2");
    await sleep(100);
    finishLater(store);
    const { out } = await ran;
    expect(
      out
        .trim()
        .split("\n")
        .map(line => seqOf(line)),
    ).toEqual([3, 4, 5, 6, 7]);
    store.close();
  });

  it("refuses a bad --limit, and has no --ids", async () => {
    seedLogs();
    const bad = await ork("logs", "L1", "--limit", "-1");
    expect(bad.err).toContain("--limit takes a positive whole number");
    expect(bad.code).toBe(1);
    expect(JSON.stringify(logs.args)).not.toContain('"ids"');
  });
});
