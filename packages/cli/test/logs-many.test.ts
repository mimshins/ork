/**
 * @file Tests for `ork logs` over several runs: called runs inline (default in
 *   text, `--no-calls`, `--calls` for JSON, `--node`, `--limit` overall, the
 *   runs still running when following ends), `--all` interleaving every live
 *   run behind its id and workflow (a later run, a called run once, `--json`,
 *   `--until-idle`), and the flags it refuses.
 */

import { stripVTControlCharacters } from "node:util";

import {
  type EventStore,
  type ListFilter,
  openStore,
  type RunEvent,
} from "@krapht/ork-core";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logs } from "../src/commands/logs.ts";
import { readListArgs } from "../src/list/flags.ts";
import { printAll, printCalls } from "../src/runs/logs-many.ts";
import { logListTable } from "../src/runs/logs.ts";
import { withShortFlags } from "../src/short-flags.ts";
import { tempDir } from "./fixtures/completion.ts";

const started = (runId: string, workflow: string): RunEvent => ({
  type: "run.started",
  runId,
  workflow,
  entries: [],
  nodes: [{ id: "step", type: "agent.worker" }],
});

const finished = (runId: string): RunEvent => ({
  type: "run.finished",
  result: {
    runId,
    status: "succeeded",
    costUsd: 0,
    nodes: [],
    reasons: [],
    worktrees: [],
  },
});

const called = (node: string, run: string, workflow: string): RunEvent => ({
  type: "call.started",
  node,
  run,
  workflow,
  project: "/p",
});

const stepStarted: RunEvent = {
  type: "node.started",
  id: "step",
  nodeType: "agent.worker",
  round: 1,
};

type Ran = {
  out: string[];
  err: string;
  code: number | string | null | undefined;
};

const plain = (lines: string[]): string[] =>
  lines.map(line => stripVTControlCharacters(line));

/** The run a JSON line of `ork logs` belongs to. */
const runIdOf = (line: string): unknown => {
  const parsed: unknown = JSON.parse(line);
  return typeof parsed === "object" && parsed !== null && "runId" in parsed
    ? parsed.runId
    : undefined;
};

/** Whether a text line is `workflow`'s own `step` line, under `prefix`. */
const isStepOf = (prefix: string) => (line: string) =>
  line.startsWith(prefix) && line.includes("step");

/** `--since`, `--until` as `ork logs` reads them. */
const filterOf = (args: Record<string, string>): ListFilter => {
  const req = readListArgs(logListTable, args);
  if (req === undefined) throw new Error("filter refused");
  return req.filter;
};

/** Starts `ork logs <words>` in this process: its lines so far, and its end. */
const startOrk = (...words: string[]): { out: string[]; ran: Promise<Ran> } => {
  const out: string[] = [];
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(text => {
    out.push(String(text).trimEnd());
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    err += String(text);
    return true;
  });
  process.exitCode = undefined;
  const ran = runCommand(withShortFlags(logs), { rawArgs: words })
    .then(() => {
      const code = process.exitCode;
      process.exitCode = undefined;
      return { out: out.flatMap(l => l.split("\n")), err, code };
    })
    .finally(() => {
      stdout.mockRestore();
      stderr.mockRestore();
    });
  return { out, ran };
};

/** What `ork logs <words>` printed, in this process. */
const ork = (...words: string[]): Promise<Ran> => startOrk(...words).ran;

/** The runs the JSON lines in `out` belong to. */
const runsOf = (out: string[]) => new Set(out.map(l => runIdOf(l)));

const printed = (lines: string[], text: string) =>
  vi.waitFor(() => {
    expect(plain(lines).join("\n")).toContain(text);
  });

/** `printAll` for project `/p`, its lines pushed to `lines`. */
const printAllOf = (
  store: EventStore,
  lines: string[],
  extra: Partial<Parameters<typeof printAll>[3]> = {},
  signal?: AbortSignal,
): Promise<void> =>
  printAll(
    store,
    { project: "/p" },
    line => {
      lines.push(line);
    },
    {
      json: false,
      intervalMs: 5,
      ...extra,
      ...(signal === undefined ? {} : { signal }),
    },
  );

describe("ork logs over several runs", () => {
  let store: EventStore;

  /** A run recorded in this process, so it reads as running until it ends. */
  const begin = (id: string, workflow: string, parent?: string): void => {
    store.begin({
      id,
      workflow,
      file: "f",
      project: "/p",
      ...(parent === undefined ? {} : { parent }),
    });
    store.append(id, started(id, workflow));
  };
  /** `root0000` called `plan0000`; both have a step. */
  const chain = (): void => {
    begin("root0000", "start");
    store.append("root0000", stepStarted);
    store.append("root0000", called("plan", "plan0000", "plan"));
    begin("plan0000", "plan", "root0000");
    store.append("plan0000", stepStarted);
  };
  const endAll = (): void => {
    for (const id of ["plan0000", "root0000"]) store.append(id, finished(id));
  };
  const options = { json: false, intervalMs: 5 };

  /** `printCalls` on `root0000`: the lines it printed. */
  const calls = async (
    extra: Partial<Parameters<typeof printCalls>[3]> = {},
  ): Promise<string[]> => {
    const lines: string[] = [];
    const [root] = store.lookup("root0000");
    if (root === undefined) throw new Error("no root");
    await printCalls(
      store,
      root,
      line => {
        lines.push(line);
      },
      { ...options, follow: false, ...extra },
    );
    return plain(lines);
  };

  beforeEach(() => {
    vi.stubEnv("HOME", tempDir("ork-logs-many-"));
    vi.stubEnv("ORK_PLAIN", "1");
    store = openStore();
  });
  afterEach(() => {
    store.close();
    vi.unstubAllEnvs();
  });

  describe("a run and the runs it called", () => {
    it("prints a called run's events right after its call.started, under the call path", async () => {
      chain();
      endAll();
      const lines = await calls();
      const at = lines.findIndex(line => line.includes("run plan0000 of plan"));
      expect(at).toBeGreaterThan(0);
      expect(lines[at]).toMatch(/^plan › /u);
      const next = lines.findIndex(line => line.includes("run root0000 succ"));
      expect(lines.slice(at, next).filter(line => line !== "")).toSatisfy(
        (own: string[]) => own.every(line => line.startsWith("plan › ")),
      );
    });

    it("keeps only the last --limit stored events, over all the runs", async () => {
      chain();
      endAll();
      const all = await calls();
      const some = await calls({ limit: 2 });
      // The called run's end, then the root's: no `step` line is left.
      expect(all.some(line => line.includes("step"))).toBe(true);
      expect(some.some(line => line.includes("step"))).toBe(false);
      expect(some.filter(line => line !== "")).toHaveLength(2);
    });

    it("lists a called run still running when following ends", async () => {
      chain();
      store.append("root0000", finished("root0000"));
      const lines = await calls({ follow: true });
      expect(lines.at(-1)).toBe(
        "↳ run plan0000 still running · ork attach plan0000",
      );
    });

    it("prints JSON lines of every run's own events", async () => {
      chain();
      endAll();
      const lines = await calls({ json: true });
      const runs = new Set(lines.map(line => runIdOf(line)));
      expect(runs).toEqual(new Set(["root0000", "plan0000"]));
    });

    it("applies --since to a called run's events", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      chain();
      vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
      endAll();
      vi.useRealTimers();
      const all = await calls();
      const since = await calls({ filter: filterOf({ since: "2026-06-01" }) });
      expect(all.filter(isStepOf("plan › "))).toHaveLength(1);
      expect(since.filter(isStepOf("plan › "))).toEqual([]);
      expect(since.some(line => line.startsWith("plan › ✓ run plan0000"))).toBe(
        true,
      );
      const until = await calls({ filter: filterOf({ until: "2026-06-01" }) });
      expect(until.filter(isStepOf("plan › "))).toHaveLength(1);
      expect(until.some(line => line.includes("succeeded"))).toBe(false);
    });

    it("applies --node to a called run's events", async () => {
      chain();
      endAll();
      const lines = await calls({ node: "step" });
      expect(lines.some(line => line.startsWith("plan › "))).toBe(true);
      expect(lines.every(line => line.includes("step"))).toBe(true);
    });
  });

  describe("the command", () => {
    it("prints called runs by default, and only the run with --no-calls", async () => {
      chain();
      endAll();
      const inline = await ork("root0000");
      expect(inline.out.some(l => l.startsWith("plan › "))).toBe(true);
      const alone = await ork("root0000", "--no-calls");
      expect(alone.out.some(l => l.includes("plan › "))).toBe(false);
      expect(alone.out.length).toBeLessThan(inline.out.length);
    });

    it("prints one run's JSON unless --calls", async () => {
      chain();
      endAll();
      expect(runsOf((await ork("root0000", "--json")).out)).toEqual(
        new Set(["root0000"]),
      );
      expect(runsOf((await ork("root0000", "--json", "--calls")).out)).toEqual(
        new Set(["root0000", "plan0000"]),
      );
    });

    it.each([
      [["--all"], "--all needs -f."],
      [["-f", "--all", "root0000"], "--all can't be used with a run."],
      [
        ["-f", "--all", "--no-calls"],
        "--calls and --no-calls don't apply to --all (a called run prints as its own).",
      ],
      [["--until-idle"], "--until-idle needs --all."],
      [["--project", "all"], "--project needs --all."],
    ])("refuses %j", async (words, message) => {
      const ran = await ork(...words);
      expect(ran.err.trim()).toBe(message);
      expect(ran.code).toBe(1);
      expect(ran.out).toEqual([]);
    });

    it("prints nothing, without an error, for a run that lacks --node's node", async () => {
      begin("aaaa1111", "plan");
      store.append("aaaa1111", { ...stepStarted, id: "extra" });
      begin("bbbb2222", "build");
      store.append("bbbb2222", stepStarted);
      const { out, ran } = startOrk(
        "-f",
        "--all",
        "--until-idle",
        "--project",
        "all",
        "--node",
        "extra",
      );
      await vi.waitFor(() => {
        expect(out.join("\n")).toContain("aaaa plan › ");
      });
      store.append("aaaa1111", finished("aaaa1111"));
      store.append("bbbb2222", finished("bbbb2222"));
      const done = await ran;
      const lines = plain(done.out).filter(line => line !== "");
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every(line => line.startsWith("aaaa plan › "))).toBe(true);
      expect(done.err).toBe("");
      expect(done.code).toBeUndefined();
    });

    it("ends `-f --all --until-idle` when no run is live, printing nothing", async () => {
      begin("root0000", "start");
      store.append("root0000", finished("root0000"));
      const ran = await ork("-f", "--all", "--until-idle", "--project", "all");
      expect(ran.out).toEqual([]);
      expect(ran.code).toBeUndefined();
    });
  });

  describe("--all", () => {
    it("prefixes every line with the run's 4-char id and workflow, stored events first", async () => {
      begin("aaaa1111", "plan");
      store.append("aaaa1111", stepStarted);
      begin("bbbb2222", "build");
      store.append("bbbb2222", stepStarted);
      const lines: string[] = [];
      const stop = new AbortController();
      const done = printAllOf(store, lines, {}, stop.signal);
      await printed(lines, "bbbb build › ");
      store.append("aaaa1111", { ...stepStarted, round: 2 });
      stop.abort();
      await done;
      const text = plain(lines);
      expect(text.some(l => l.startsWith("aaaa plan › "))).toBe(true);
      expect(text.every(l => /^(aaaa plan|bbbb build) › /u.test(l))).toBe(true);
    });

    it("picks up a run that starts later, from its first event", async () => {
      begin("aaaa1111", "plan");
      const lines: string[] = [];
      const stop = new AbortController();
      const done = printAllOf(store, lines, {}, stop.signal);
      await printed(lines, "aaaa plan › ");
      begin("cccc3333", "late");
      await printed(lines, "cccc late › ");
      stop.abort();
      await done;
      const first = plain(lines).find(l => l.startsWith("cccc late › "));
      expect(first).toContain("late");
    });

    it("prints a called run once, under its own id and workflow", async () => {
      chain();
      const lines: string[] = [];
      const stop = new AbortController();
      const done = printAllOf(store, lines, {}, stop.signal);
      await printed(lines, "plan plan › ");
      stop.abort();
      await done;
      const starts = plain(lines).filter(isStepOf("plan plan › "));
      expect(starts).toHaveLength(1);
    });

    it("prints JSON lines as stored, without a prefix", async () => {
      begin("aaaa1111", "plan");
      store.append("aaaa1111", stepStarted);
      const lines: string[] = [];
      const stop = new AbortController();
      const done = printAllOf(store, lines, { json: true }, stop.signal);
      await vi.waitFor(() => {
        expect(lines).toHaveLength(2);
      });
      stop.abort();
      await done;
      expect(lines.map(l => runIdOf(l))).toEqual(["aaaa1111", "aaaa1111"]);
    });

    it("ends once no run is live with --until-idle", async () => {
      begin("aaaa1111", "plan");
      const lines: string[] = [];
      const done = printAllOf(store, lines, { untilIdle: true });
      await printed(lines, "aaaa plan › ");
      store.append("aaaa1111", finished("aaaa1111"));
      await expect(done).resolves.toBeUndefined();
    });

    it("keeps the last --limit stored events of the live runs, not later ones", async () => {
      begin("aaaa1111", "plan");
      store.append("aaaa1111", stepStarted);
      const lines: string[] = [];
      const stop = new AbortController();
      const done = printAllOf(store, lines, { limit: 1 }, stop.signal);
      await printed(lines, "aaaa plan › ");
      stop.abort();
      await done;
      expect(lines).toHaveLength(1);
    });
  });
});
