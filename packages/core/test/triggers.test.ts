/**
 * @file Tests for triggers (RFC-011): the guards `ork watch` keeps so no author
 *   has to, what a person accepts, and what `ork validate` says of a trigger.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type CheckEvent,
  parseTriggers,
  parseWorkflow,
  type Trigger,
  type Workflow,
} from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  checkTrigger,
  createWatcher,
  declaredTriggers,
  type DeclaredTrigger,
  lateTriggers,
  type LookResult,
  openStore,
  readProjectTriggers,
  START_TRIES,
  stillTheSameProcess,
  triggerHash,
  triggersReport,
  triggerStanding,
} from "../src/index.ts";

const trigger = (more: Partial<Trigger> = {}): Trigger => ({
  every: "1m",
  check: { type: "tool.shell", command: "x" },
  run: "triage",
  ...more,
});

const declaredOf = (more: Partial<Trigger> = {}): DeclaredTrigger => ({
  project: "p",
  id: "t",
  trigger: trigger(more),
  hash: "h",
});

/** A schedule: a trigger with no check. */
const NO_CHECK = undefined as Trigger["check"];

const events = (...keys: readonly string[]): LookResult => ({
  ok: true,
  events: keys.map(key => ({ key, inputs: { issue: key } })),
});

const refusing = (bad: string) => (key: string) =>
  key === bad ? "refused" : undefined;

const NOT_HELD = undefined as string | undefined;
const NO_ANSWER = undefined as number | undefined;

/** A watcher whose clock moves on demand, with what it started so far. */
const harness = (
  options: {
    trigger?: Partial<Trigger>;
    accepted?: boolean;
    look?: () => LookResult;
    startError?: string | ((key: string) => string | undefined);
    running?: () => boolean;
    blocked?: () => string | undefined;
  } = {},
) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-triggers-"));
  const store = openStore(path.join(dir, "state.db"));
  const declared = declaredOf(options.trigger);
  if (options.accepted !== false) store.acceptTrigger("p", "t", "h");
  const started: CheckEvent[] = [];
  const tried: string[] = [];
  let looks = 0;
  let current = events();
  let at = Date.parse("2026-11-04T10:00:00Z");
  let ids = 0;
  const watcher = createWatcher({
    store,
    declared: () => [declared],
    look: () => {
      looks += 1;
      return Promise.resolve(options.look?.() ?? current);
    },
    start: (_declared, event) => {
      tried.push(event.key);
      const { startError: refuses } = options;
      const error =
        typeof refuses === "function" ? refuses(event.key) : refuses;
      if (error !== undefined) return Promise.resolve({ ok: false, error });
      started.push(event);
      return Promise.resolve({ ok: true });
    },
    newRunId: () => {
      ids += 1;
      return `r${String(ids)}`;
    },
    isRunning: () => options.running?.() ?? false,
    blocked: () => options.blocked?.(),
    now: () => new Date(at),
  });
  return {
    store,
    started,
    tried,
    keys: () => started.map(({ key }) => key),
    looks: () => looks,
    says: (result: LookResult) => {
      current = result;
    },
    /** Moves the clock back, as a person or a dead battery can. */
    clockBack: (minutes: number) => {
      at -= minutes * 60_000;
    },
    /** Moves the clock on by a trigger's `every`, and looks. */
    look: async (minutes = 1) => {
      at += minutes * 60_000;
      watcher.tick();
      await watcher.settled();
    },
    record: () => store.triggerRecords("p")[0],
  };
};

describe("the guards", () => {
  it("starts nothing on the first look, so a backlog stays a backlog", async () => {
    const watching = harness();
    watching.says(events("1", "2", "3"));
    await watching.look();
    expect(watching.started).toEqual([]);
    expect(watching.record()?.baselined).toBe(true);
  });

  it("starts each new key, once", async () => {
    const watching = harness();
    watching.says(events("1"));
    await watching.look();
    watching.says(events("1", "2"));
    await watching.look();
    await watching.look();
    expect(watching.keys()).toEqual(["2"]);
    expect(watching.started[0]?.inputs).toEqual({ issue: "2" });
  });

  it("doesn't start a key again because its run ended, however it ended", async () => {
    let going = true;
    const watching = harness({ running: () => going });
    await watching.look();
    watching.says(events("1"));
    await watching.look();
    going = false;
    await watching.look();
    expect(watching.keys()).toEqual(["1"]);
  });

  it("starts a key once when a report lists it twice", async () => {
    const watching = harness({ trigger: { concurrency: 5 } });
    await watching.look();
    watching.says(events("1", "1"));
    await watching.look();
    expect(watching.keys()).toEqual(["1"]);
    expect(watching.store.triggerRuns("p", "t", "")).toEqual(["r1"]);
  });

  it("goes on past a key that won't start", async () => {
    const watching = harness({
      trigger: { concurrency: 5 },
      startError: refusing("bad"),
    });
    await watching.look();
    watching.says(events("bad", "after"));
    await watching.look();
    expect(watching.keys()).toEqual(["after"]);
    expect(watching.record()?.error).toBe("refused");
  });

  it("gives up on a key after a few tries, and says so nowhere else", async () => {
    const watching = harness({ startError: "refused" });
    await watching.look();
    watching.says(events("bad"));
    for (let look = 0; look < START_TRIES + 2; look += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one look after another
      await watching.look();
    }
    expect(watching.tried).toHaveLength(START_TRIES);
    expect(watching.store.seenKeys("p", "t", ["bad"]).size).toBe(1);
    expect(watching.store.triggerRuns("p", "t", "")).toEqual([]);
  });

  it("tries a key again when its run didn't start at all", async () => {
    const watching = harness({ startError: "no room" });
    await watching.look();
    watching.says(events("1"));
    await watching.look();
    expect(watching.record()?.error).toBe("no room");
    expect(watching.store.seenKeys("p", "t", ["1"]).size).toBe(0);
  });

  it("has a daily cap, and a new day lifts it", async () => {
    const watching = harness({ trigger: { maxRunsPerDay: 2 } });
    await watching.look();
    watching.says(events("1", "2", "3"));
    await watching.look();
    expect(watching.keys()).toEqual(["1", "2"]);
    expect(watching.record()?.held).toContain("2 runs for today");
    await watching.look(24 * 60);
    expect(watching.keys()).toEqual(["1", "2", "3"]);
  });

  it("takes one run at a time by default; a new key waits", async () => {
    let going = false;
    const watching = harness({ running: () => going });
    await watching.look();
    watching.says(events("1", "2"));
    going = true;
    await watching.look();
    expect(watching.keys()).toEqual(["1"]);
    expect(watching.record()?.held).toContain("still going");
    going = false;
    await watching.look();
    expect(watching.keys()).toEqual(["1", "2"]);
  });

  it("is held by a limit across runs until it resets", async () => {
    let limit: string | undefined = "this week's cap is spent";
    const watching = harness({ blocked: () => limit });
    await watching.look();
    watching.says(events("1"));
    await watching.look();
    expect(watching.keys()).toEqual([]);
    expect(watching.record()?.held).toBe("this week's cap is spent");
    limit = undefined;
    await watching.look();
    expect(watching.keys()).toEqual(["1"]);
    expect(watching.record()?.held).toBeUndefined();
  });

  it("carries on after a failed look, starting nothing", async () => {
    const watching = harness();
    await watching.look();
    watching.says({ ok: false, error: "offline" });
    await watching.look();
    expect(watching.record()?.error).toBe("offline");
    watching.says(events("1"));
    await watching.look();
    expect(watching.keys()).toEqual(["1"]);
    expect(watching.record()?.error).toBeUndefined();
  });

  it("looks only when it's due", async () => {
    const watching = harness({ trigger: { every: "5m" } });
    await watching.look();
    await watching.look(1);
    expect(watching.looks()).toBe(1);
    await watching.look(5);
    expect(watching.looks()).toBe(2);
  });

  it("looks when the clock has moved back, rather than stopping", async () => {
    const watching = harness({ trigger: { every: "5m" } });
    await watching.look();
    watching.clockBack(60);
    await watching.look(0);
    expect(watching.looks()).toBe(2);
  });

  it("doesn't look at all until a person accepts it", async () => {
    const watching = harness({ accepted: false });
    await watching.look();
    expect(watching.looks()).toBe(0);
  });

  it("starts a plain schedule every time, but not on its first look", async () => {
    const watching = harness({ trigger: { check: NO_CHECK } });
    await watching.look();
    expect(watching.started).toEqual([]);
    await watching.look();
    await watching.look();
    expect(watching.started).toHaveLength(2);
  });

  it("starts nothing again after being accepted anew", async () => {
    const watching = harness();
    await watching.look();
    watching.store.acceptTrigger("p", "t", "h");
    watching.says(events("9"));
    await watching.look();
    expect(watching.started).toEqual([]);
  });
});

const watcherOver = (
  list: readonly DeclaredTrigger[],
  more: Partial<Parameters<typeof createWatcher>[0]>,
) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-triggers-"));
  const store = openStore(path.join(dir, "state.db"));
  for (const { project, id } of list) store.acceptTrigger(project, id, "h");
  return {
    store,
    watcher: createWatcher({
      store,
      declared: () => list,
      look: () => Promise.resolve(events()),
      start: () => Promise.resolve({ ok: true }),
      newRunId: () => "r",
      isRunning: () => false,
      blocked: () => NOT_HELD,
      ...more,
    }),
  };
};

/**
 * A look that does this for the trigger called `stuck`, and is fine for the
 * rest.
 */
const whenStuck =
  (result: () => Promise<LookResult>) =>
  ({ id }: DeclaredTrigger): Promise<LookResult> =>
    id === "stuck" ? result() : Promise.resolve(events());

describe("one trigger can't get in another's way", () => {
  const two = [
    { ...declaredOf(), id: "stuck" },
    { ...declaredOf(), id: "fine" },
  ];

  it("looks at the rest while one is stuck", async () => {
    const looked: string[] = [];
    const { promise: never } = Promise.withResolvers<LookResult>();
    const looking = whenStuck(() => never);
    const { watcher } = watcherOver(two, {
      look: declared => {
        looked.push(declared.id);
        return looking(declared);
      },
    });
    watcher.tick();
    await Promise.resolve();
    expect(looked).toEqual(["stuck", "fine"]);
  });

  it("records a look that throws, and goes on", async () => {
    const { store, watcher } = watcherOver(two, {
      look: whenStuck(() => Promise.reject(new Error("EISDIR"))),
    });
    watcher.tick();
    await watcher.settled();
    const records = store.triggerRecords("p");
    expect(records.find(item => item.trigger === "stuck")?.error).toBe(
      "EISDIR",
    );
    expect(records.find(item => item.trigger === "fine")?.baselined).toBe(true);
  });

  it("survives not being able to read what's declared", () => {
    const notes: string[] = [];
    const { watcher } = watcherOver([], {
      declared: () => {
        throw new Error("EMFILE");
      },
      note: line => {
        notes.push(line);
      },
    });
    expect(() => {
      watcher.tick();
    }).not.toThrow();
    expect(notes[0]).toContain("EMFILE");
  });

  it("survives the store failing while it records", async () => {
    const { store, watcher } = watcherOver(two, {
      look: () => Promise.reject(new Error("offline")),
    });
    store.recordLook = () => {
      throw new Error("database is locked");
    };
    watcher.tick();
    await expect(watcher.settled()).resolves.toBeUndefined();
  });
});

describe("what a person accepts", () => {
  it("changes with the trigger and with the workflow it starts", () => {
    const hash = triggerHash(trigger(), "a");
    expect(triggerHash(trigger(), "a")).toBe(hash);
    expect(triggerHash(trigger({ every: "2m" }), "a")).not.toBe(hash);
    expect(triggerHash(trigger(), "b")).not.toBe(hash);
  });

  it("changes with the folder, so another repository doesn't inherit it", () => {
    expect(triggerHash(trigger(), "a", "/one")).not.toBe(
      triggerHash(trigger(), "a", "/other"),
    );
  });

  it("changes with what the check reads", () => {
    expect(triggerHash(trigger(), "a", "/one", ["x"])).not.toBe(
      triggerHash(trigger(), "a", "/one", ["y"]),
    );
  });

  it("doesn't depend on the order of a file's keys", () => {
    const one: Trigger = { every: "1m", run: "x" };
    const other: Trigger = { run: "x", every: "1m" };
    expect(triggerHash(one, "a")).toBe(triggerHash(other, "a"));
  });

  it("tells new from changed from live", () => {
    const declared = { hash: "h" };
    const base = { project: "p", trigger: "t", baselined: true };
    expect(triggerStanding(declared)).toBe("new");
    expect(triggerStanding(declared, { ...base, acceptedHash: "old" })).toBe(
      "changed",
    );
    expect(triggerStanding(declared, { ...base, acceptedHash: "h" })).toBe(
      "live",
    );
  });
});

const workflowOf = (lines: readonly string[]): Workflow => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: triage", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const SAFE = workflowOf([
  "inputs:",
  "  issue: { type: string, required: true }",
  "nodes:",
  "  a: { type: tool.shell, command: x }",
  "limits: { budgetUsd: 1 }",
]);

const reading = (tools: string): Workflow =>
  workflowOf([
    "inputs:",
    "  issue: { type: string, required: true }",
    "nodes:",
    "  a:",
    "    type: claude.worker",
    '    prompt: "Triage {{inputs.issue}}"',
    ...(tools === "" ? [] : [`    tools: ${tools}`]),
    "limits: { budgetUsd: 1 }",
  ]);

const codes = (more: Partial<Trigger>, workflow: Workflow | null): string[] =>
  checkTrigger("t", trigger(more), workflow).map(({ code }) => code);

const withEnv = (value: string) =>
  codes(
    {
      check: {
        type: "tool.shell",
        command: "x",
        env: { TOKEN: value },
      },
    },
    SAFE,
  );

describe("checking a trigger", () => {
  it("accepts one with a capped workflow", () => {
    expect(codes({}, SAFE)).toEqual([]);
  });

  it("refuses a workflow that isn't there", () => {
    expect(codes({}, null)).toEqual(["trigger.workflow"]);
  });

  it("refuses a workflow with no spending cap", () => {
    expect(
      codes(
        {},
        workflowOf(["nodes:", "  a: { type: tool.shell, command: x }"]),
      ),
    ).toEqual(["trigger.budget"]);
  });

  it("refuses an input the workflow doesn't declare", () => {
    expect(codes({ inputs: { nope: "x" } }, SAFE)).toEqual(["trigger.input"]);
  });

  it("refuses a schedule that can't fill a required input", () => {
    expect(codes({ check: undefined }, SAFE)).toEqual(["trigger.input"]);
    expect(codes({ check: undefined, inputs: { issue: "x" } }, SAFE)).toEqual(
      [],
    );
  });

  it("refuses a check with templates, which have nothing to read", () => {
    expect(
      codes(
        { check: { type: "tool.shell", command: "x {{inputs.issue}}" } },
        SAFE,
      ),
    ).toEqual(["trigger.check"]);
  });

  it("refuses a template anywhere a check would read one", () => {
    expect(
      codes(
        {
          check: {
            type: "mcp.call",
            server: "s",
            tool: "t",
            arguments: { deep: { q: "{{inputs.issue}}" } },
          },
        },
        SAFE,
      ),
    ).toEqual(["trigger.check"]);
  });

  it("takes text that looks like a template in a script, which reads none", () => {
    expect(
      codes(
        { check: { type: "tool.shell", script: "docker ps -f '{{.ID}}'" } },
        SAFE,
      ),
    ).toEqual([]);
  });

  it("lets a check's env read the user's variables, and nothing else", () => {
    expect(withEnv("{{env.TOKEN}}")).toEqual([]);
    expect(withEnv("{{inputs.issue}}")).toEqual(["trigger.check"]);
  });

  it("doesn't take a name from what every object has", () => {
    expect(codes({ inputs: { constructor: "x" } }, SAFE)).toEqual([
      "trigger.input",
    ]);
  });

  it("still warns when the tools it's narrowed to can act", () => {
    expect(codes({}, reading("{ only: [Bash] }"))).toEqual([
      "trigger.untrusted",
    ]);
  });

  it("warns when a prompt reads what a check found, with broad tools", () => {
    expect(codes({}, reading(""))).toEqual(["trigger.untrusted"]);
  });

  it("doesn't warn once its tools are narrowed", () => {
    expect(codes({}, reading("{ only: [Read] }"))).toEqual([]);
  });

  it("doesn't warn of an input the trigger sets itself", () => {
    expect(codes({ inputs: { issue: "fixed" } }, reading(""))).toEqual([]);
  });

  it("doesn't warn of a schedule, which reads no source", () => {
    expect(
      codes({ check: undefined, inputs: { issue: "fixed" } }, reading("")),
    ).toEqual([]);
  });
});

const project = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-trigger-report-"));
  const dir = path.join(root, ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(
    path.join(dir, "workflows", "triage.ork.yaml"),
    "schemaVersion: 1\nname: triage\nnodes:\n  a: { type: tool.shell, command: x }\nlimits: { budgetUsd: 1 }\n",
  );
  writeFileSync(
    path.join(dir, "triggers.yaml"),
    "schemaVersion: 1\ntriggers:\n  t: { every: 1m, run: triage }\n  bad: { every: 1m, run: gone }\n",
  );
  return {
    id: "p",
    root,
    dir,
    mode: "in-repo" as const,
    registeredAt: "2026-11-04T10:00:00Z",
  };
};

const looked = (lookedAt: string) => ({
  pid: 1,
  broken: [],
  triggers: [
    {
      project: "p",
      trigger: "t",
      run: "x",
      every: "1m",
      standing: "live" as const,
      lookedAt,
      problems: [],
      warnings: [],
    },
  ],
});

const fileWith = (every: string) =>
  `schemaVersion: 1\ntriggers:\n  a: { every: ${every}, run: x }\n`;

describe("the file", () => {
  it.each(["../../x", "--flag", "a/b", ".hidden"])(
    "refuses %s as a workflow's name",
    name => {
      const file = `schemaVersion: 1\ntriggers:\n  a: { every: 1m, run: ${JSON.stringify(name)} }\n`;
      expect(parseTriggers(file).ok).toBe(false);
    },
  );

  it("has a floor on how often a trigger looks", () => {
    expect(parseTriggers(fileWith("1m")).ok).toBe(true);
    expect(parseTriggers(fileWith("59s")).ok).toBe(false);
  });
});

const reportOf = () => {
  const place = project();
  const home = mkdtempSync(path.join(tmpdir(), "ork-trigger-home-"));
  const store = openStore(path.join(home, "state.db"));
  return {
    store,
    read: () => triggersReport(store, [place], home),
    place,
  };
};

const hashOf = (place: ReturnType<typeof project>, id = "t") =>
  readProjectTriggers(place).triggers.find(item => item.id === id)?.hash;

describe("reading a project", () => {
  it("turns a trigger off when its workflow changes", () => {
    const place = project();
    const before = hashOf(place);
    writeFileSync(
      path.join(place.dir, "workflows", "triage.ork.yaml"),
      "schemaVersion: 1\nname: triage\nnodes:\n  b: { type: tool.shell, command: y }\nlimits: { budgetUsd: 1 }\n",
    );
    expect(hashOf(place)).not.toBe(before);
  });

  it("offers only what can run", () => {
    const declared = declaredTriggers([project()]);
    expect(declared.map(({ id }) => id)).toEqual(["t"]);
  });

  it("turns a trigger off when the file its check names changes", () => {
    const place = project();
    const script = path.join(place.root, "check.sh");
    writeFileSync(script, "one");
    writeFileSync(
      path.join(place.dir, "triggers.yaml"),
      "schemaVersion: 1\ntriggers:\n  t: { every: 1m, run: triage, check: { type: tool.shell, command: ./check.sh } }\n",
    );
    const before = hashOf(place);
    writeFileSync(script, "two");
    expect(hashOf(place)).not.toBe(before);
  });

  it("turns an MCP check off when .mcp.json changes", () => {
    const place = project();
    const servers = path.join(place.root, ".mcp.json");
    writeFileSync(servers, "{}");
    writeFileSync(
      path.join(place.dir, "triggers.yaml"),
      "schemaVersion: 1\ntriggers:\n  t: { every: 1m, run: triage, check: { type: mcp.call, server: s, tool: t } }\n",
    );
    const before = hashOf(place);
    writeFileSync(servers, '{"mcpServers":{}}');
    expect(hashOf(place)).not.toBe(before);
  });

  it("says a file it can't read is broken, rather than throwing", () => {
    const place = project();
    const file = path.join(place.dir, "triggers.yaml");
    rmSync(file);
    mkdirSync(file);
    const found = readProjectTriggers(place);
    expect(found.triggers).toEqual([]);
    expect(found.diagnostics[0]?.code).toBe("trigger.read");
  });
});

describe("a forgotten project", () => {
  it("leaves nothing for a later one of the same name to inherit", () => {
    const { store } = reportOf();
    store.addProject({ id: "p", root: "/r", mode: "in-repo", dir: "/r/.ork" });
    store.acceptTrigger("p", "t", "h");
    store.baselineTrigger("p", "t", ["1"], "2026-11-04T10:00:00Z");
    store.forgetProject("p");
    expect(store.triggerRecords("p")).toEqual([]);
    expect(store.seenKeys("p", "t", ["1"]).size).toBe(0);
  });
});

const later = () => Date.parse("2026-11-04T10:00:00Z");

describe("a process id that came round again", () => {
  it("isn't the process that recorded something before it started", () => {
    expect(
      stillTheSameProcess(process.pid, "2026-11-04T09:00:00Z", later),
    ).toBe(false);
    expect(
      stillTheSameProcess(process.pid, "2026-11-04T10:00:00Z", later),
    ).toBe(true);
  });

  it("counts a live process when it can't tell", () => {
    expect(
      stillTheSameProcess(process.pid, "2001-01-01T00:00:00Z", () => NO_ANSWER),
    ).toBe(true);
  });

  it("says this one is itself", () => {
    expect(stillTheSameProcess(process.pid, new Date().toISOString())).toBe(
      true,
    );
  });

  it("says a gone one is gone", () => {
    expect(stillTheSameProcess(99_999_999, new Date().toISOString())).toBe(
      false,
    );
  });
});

describe("the report", () => {
  it("says what's off, and why", () => {
    const { read } = reportOf();
    const { triggers } = read();
    expect(triggers.find(item => item.trigger === "t")?.standing).toBe("new");
    const bad = triggers.find(item => item.trigger === "bad");
    expect(bad?.standing).toBe("invalid");
    expect(bad?.problems[0]).toContain("no valid workflow");
  });

  it("calls a live trigger late when nothing is watching", () => {
    const report = {
      broken: [],
      triggers: [
        {
          project: "p",
          trigger: "t",
          run: "x",
          every: "1m",
          standing: "live" as const,
          problems: [],
          warnings: [],
        },
      ],
    };
    expect(lateTriggers(report, new Date())).toHaveLength(1);
    expect(lateTriggers({ ...report, pid: 1 }, new Date())).toEqual([]);
  });

  it("calls a live trigger late when it should have looked by now", () => {
    const at = new Date("2026-11-04T10:00:00Z");
    expect(lateTriggers(looked("2026-11-04T11:00:00Z"), at)).toHaveLength(1);
    expect(lateTriggers(looked("2026-11-04T09:59:30Z"), at)).toEqual([]);
    expect(lateTriggers(looked("2026-11-04T09:50:00Z"), at)).toHaveLength(1);
  });
});
