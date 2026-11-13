/**
 * @file Tests for follow-ups past keeping them: delivery by `for` (this
 *   project, another registered project with its own rule, relayed to the top
 *   running node of a live run there, an unknown project refused), the per-
 *   session port's cap and event, coming due through a fake `gh` (merged,
 *   closed unmerged, a branch in the base, a date), `due <id|run>`, a run that
 *   publishes, taking follow-ups as a brief, and posting a GitHub message only
 *   once confirmed.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  availableDue,
  checkFollowUpsDue,
  createFollowUps,
  deliverFollowUp,
  type EventStore,
  FOLLOW_UP_CAP,
  type FollowUpDelivered,
  type FollowUpPort,
  type FollowUpRelayed,
  followUpProblem,
  followUpStore,
  type GhResult,
  type GhRunner,
  heldNote,
  markDue,
  type NewFollowUp,
  openStore,
  postFollowUpMessage,
  recordPublished,
  type RunEvent,
  type RunLive,
  startFollowUpChecks,
  takeFollowUps,
} from "../src/index.ts";

const HOME = "/Users/someone";
const HERE = "/work/web";
const AT = "2026-11-12T10:00:00.000Z";

const tempDir = () => mkdtempSync(path.join(tmpdir(), "ork-follow-up-"));

const change: NewFollowUp = {
  title: "Add retries to the billing client",
  for: "agent",
  kind: "change",
  due: "after-merge",
  from: { run: "r1", node: "build" },
};

const ok = (stdout = ""): GhResult => ({ ok: true, stdout, stderr: "" });
const failed = (stderr: string): GhResult => ({
  ok: false,
  stdout: "",
  stderr,
});

/** A `gh` answering by its first two arguments; anything else fails. */
const ghFrom = (answers: Record<string, GhResult>) => {
  const calls: string[][] = [];
  const gh: GhRunner = args => {
    calls.push([...args]);
    return Promise.resolve(
      answers[args.slice(0, 2).join(" ")] ?? failed("unexpected"),
    );
  };
  return { gh, calls };
};

const prState = (state: string) => ({
  "pr view": ok(JSON.stringify({ state })),
});

/** This project's store, with follow-ups kept in Ork's store. */
const keep = async (
  store: EventStore,
  ...inputs: NewFollowUp[]
): Promise<void> => {
  const here = followUpStore({
    rows: store,
    project: HERE,
    home: HOME,
    now: () => AT,
  });
  for (const input of inputs) {
    // oxlint-disable-next-line no-await-in-loop -- in order, as a session would
    await here.add(input);
  }
};

/** Another registered project, `api`, with its rules file. */
const otherProject = (store: EventStore, rules?: string): string => {
  const root = tempDir();
  mkdirSync(path.join(root, ".ork"));
  if (rules !== undefined) {
    writeFileSync(path.join(root, ".ork/project.yaml"), rules);
  }
  store.addProject({
    id: "api",
    root,
    mode: "in-repo",
    dir: path.join(root, ".ork"),
  });
  return root;
};

/** A live run of `project` whose worker started before its leader. */
const liveRun = (store: EventStore, project: string): void => {
  store.begin({ id: "r9", workflow: "w", file: "w.ork.yaml", project });
  const events: RunEvent[] = [
    {
      type: "run.started",
      runId: "r9",
      workflow: "w",
      entries: [],
      nodes: [
        { id: "lead", type: "agent.leader" },
        { id: "worker", type: "agent.worker", parent: "lead" },
      ],
    },
    { type: "node.started", id: "worker", nodeType: "agent.worker", round: 1 },
    { type: "node.started", id: "lead", nodeType: "agent.leader", round: 1 },
  ];
  for (const event of events) store.append("r9", event);
};

/** Marks this project's first follow-up done, as `ork follow-ups done` would. */
const markDone = (store: EventStore): void => {
  const [f] = store.followUps(HERE);
  if (f !== undefined) store.putFollowUp({ ...f, status: "done" });
};

/** `count` follow-ups added one after another, as a session would. */
const oneByOne = async (
  port: FollowUpPort,
  count: number,
): Promise<FollowUpDelivered[]> => {
  const results: FollowUpDelivered[] = [];
  for (let i = 0; i < count; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- in order, as a session would
    results.push(await port.add(change));
  }
  return results;
};

/** The id of this project's follow-up at `index`. */
const idAt = (store: EventStore, index: number): string => {
  const f = store.followUps(HERE)[index];
  if (f === undefined) throw new Error(`no follow-up at ${String(index)}`);
  return f.id;
};

/** What a sink says it kept, relayed or not. */
const added = (relayed?: FollowUpRelayed): FollowUpDelivered => ({
  ok: true,
  added: {
    merged: false,
    followUp: {
      ...change,
      id: "f1",
      project: HERE,
      body: "",
      where: [],
      from: {},
      status: "waiting",
      place: "store",
      createdAt: AT,
      updatedAt: AT,
    },
  },
  ...(relayed === undefined ? {} : { relayed }),
});

const telling = () => {
  const told: { to: FollowUpRelayed; text: string }[] = [];
  const tell = (to: FollowUpRelayed, text: string) => {
    told.push({ to, text });
    return Promise.resolve(true);
  };
  return { told, tell };
};

describe("followUpProblem", () => {
  it.each([
    [{ ...change, title: " " }, "the title is empty"],
    [{ ...change, for: "team" }, /`for` is agent/u],
    [{ ...change, due: "tomorrow" }, /`due` is now/u],
    [{ ...change, due: "2026-13-45" }, /`due` is now/u],
    [{ ...change, kind: "message", for: "person:Dana" }, /needs its `draft`/u],
    [
      { ...change, kind: "task", steps: [{ text: "ok" }, { text: " " }] },
      "each step needs its text",
    ],
    [
      { ...change, kind: "task", steps: [{ text: "", command: "" }] },
      "each step needs its text",
    ],
  ] as const)("refuses %o", (input, error) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately wrong values
    expect(followUpProblem(input as NewFollowUp)).toMatch(error);
  });

  it("takes a dated message with its draft", () => {
    const message: NewFollowUp = {
      ...change,
      kind: "message",
      for: "person:Dana",
      due: "2026-12-01",
      draft: { to: "Dana", text: "It shipped." },
    };
    expect(followUpProblem(message)).toBeNull();
  });
});

describe("deliverFollowUp", () => {
  it("keeps one for this project in its own list", async () => {
    const store = openStore(":memory:");
    const result = await deliverFollowUp(change, {
      store,
      project: HERE,
      home: HOME,
    });
    expect(result).toMatchObject({ ok: true, added: { merged: false } });
    expect(store.followUps(HERE).map(f => f.title)).toEqual([change.title]);
  });

  it("refuses an unknown project, naming the registered ones", async () => {
    const store = openStore(":memory:");
    otherProject(store);
    const result = await deliverFollowUp(
      { ...change, for: "project:billing" },
      { store, project: HERE, home: HOME },
    );
    expect(result).toEqual({
      ok: false,
      error: "there is no registered project `billing`; registered: api",
    });
  });

  it("adds one for another project to its list, through its own rule", async () => {
    const store = openStore(":memory:");
    const root = otherProject(
      store,
      "schemaVersion: 1\nfollowUps:\n  store: file\n",
    );
    const { told, tell } = telling();
    const result = await deliverFollowUp(
      { ...change, for: "project:api" },
      { store, project: HERE, home: HOME, tell },
    );
    expect(result).toMatchObject({
      ok: true,
      added: { followUp: { place: "file" } },
    });
    expect(store.followUps(root).length).toBe(1);
    expect(store.followUps(HERE)).toEqual([]);
    expect(
      readFileSync(path.join(root, ".ork/follow-ups.md"), "utf8"),
    ).toContain(change.title);
    expect(told).toEqual([]);
  });

  it("relays it to the top running node of a live run there", async () => {
    const store = openStore(":memory:");
    const root = otherProject(store);
    liveRun(store, root);
    const { told, tell } = telling();
    const result = await deliverFollowUp(
      { ...change, for: "project:api" },
      { store, project: HERE, home: HOME, tell },
    );
    expect(result).toMatchObject({ relayed: { run: "r9", node: "lead" } });
    expect(told.map(t => t.to)).toEqual([{ run: "r9", node: "lead" }]);
    expect(told[0]?.text).toContain(`from run r1`);
    expect(told[0]?.text).toContain(change.title);
  });

  it("keeps it, with a note, when the live run can't be told", async () => {
    const store = openStore(":memory:");
    liveRun(store, otherProject(store));
    const result = await deliverFollowUp(
      { ...change, for: "project:api" },
      {
        store,
        project: HERE,
        home: HOME,
        tell: () => Promise.reject(new Error("socket gone")),
      },
    );
    expect(result).toMatchObject({ ok: true, added: { merged: false } });
    expect(JSON.stringify(result)).toContain("socket gone");
  });

  it("doesn't relay a duplicate again", async () => {
    const store = openStore(":memory:");
    liveRun(store, otherProject(store));
    const { told, tell } = telling();
    const options = { store, project: HERE, home: HOME, tell };
    await deliverFollowUp({ ...change, for: "project:api" }, options);
    await deliverFollowUp({ ...change, for: "project:api" }, options);
    expect(told.length).toBe(1);
  });

  it("refuses what followUpProblem refuses", async () => {
    const store = openStore(":memory:");
    const result = await deliverFollowUp(
      { ...change, title: "" },
      { store, project: HERE },
    );
    expect(result).toEqual({ ok: false, error: "the title is empty" });
  });
});

describe("a session's follow-up port", () => {
  it("records the run, node and worktree, and passes the result back", async () => {
    const seen: { input: NewFollowUp; cwd: string }[] = [];
    const ports = createFollowUps({
      runId: "r1",
      sink: (input, at) => {
        seen.push({ input, cwd: at.cwd });
        return Promise.resolve(added({ run: "r9", node: "lead" }));
      },
    });
    const result = await ports
      .port("build", "/wt")
      .add({ ...change, from: { run: "x" } });
    expect(seen.map(s => [s.input.from, s.cwd])).toEqual([
      [{ run: "r1", node: "build" }, "/wt"],
    ]);
    expect(result).toMatchObject({ relayed: { run: "r9", node: "lead" } });
  });

  it("doesn't count a follow-up the sink refused", async () => {
    const ports = createFollowUps({
      runId: "r1",
      sink: () => Promise.reject(new Error("disk full")),
    });
    const results = await oneByOne(
      ports.port("build", "/wt"),
      FOLLOW_UP_CAP + 1,
    );
    expect(results.at(-1)).toEqual({ ok: false, error: "disk full" });
  });

  it(`takes at most ${String(FOLLOW_UP_CAP)} per session`, async () => {
    const ports = createFollowUps({
      runId: "r1",
      sink: () => Promise.resolve(added()),
    });
    const port = ports.port("build", "/wt");
    const results = await Promise.all(
      Array.from({ length: FOLLOW_UP_CAP + 1 }, () => port.add(change)),
    );
    expect(results.filter(r => r.ok).length).toBe(FOLLOW_UP_CAP);
    expect(results.at(-1)).toMatchObject({ ok: false });
    expect((await ports.port("other", "/wt").add(change)).ok).toBe(true);
  });
});

describe("checkFollowUpsDue", () => {
  const withRef = { ...change, ref: "https://github.com/acme/web/pull/7" };

  it("makes after-merge follow-ups due when their PR merged", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef);
    const { gh } = ghFrom(prState("MERGED"));
    const result = await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(result.due.map(f => [f.status, f.note])).toEqual([
      ["due", `${withRef.ref} merged`],
    ]);
  });

  it("makes them due with a note when the PR closed unmerged", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef);
    const { gh } = ghFrom(prState("CLOSED"));
    await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(store.followUps(HERE)[0]?.status).toBe("due");
    expect(store.followUps(HERE)[0]?.note).toMatch(/closed without merging/u);
  });

  it("leaves one closed while gh answered as it is", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef);
    const gh: GhRunner = () => {
      // The maintainer marks it done while `gh` is still answering.
      markDone(store);
      return Promise.resolve(ok(JSON.stringify({ state: "MERGED" })));
    };
    const result = await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(result.due).toEqual([]);
    expect(store.followUps(HERE)[0]?.status).toBe("done");
  });

  it("leaves them waiting while the PR is open, reading each ref once", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef, { ...withRef, title: "Another", for: "me" });
    const { gh, calls } = ghFrom(prState("OPEN"));
    const result = await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(result.due).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it("makes them due when a branch without a PR is in the base", async () => {
    const store = openStore(":memory:");
    await keep(store, { ...change, ref: "ork/r1" });
    const { gh, calls } = ghFrom({
      "repo view": ok("main\n"),
      "api repos/{owner}/{repo}/compare/main...ork/r1": ok("behind\n"),
    });
    const result = await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(result.due.length).toBe(1);
    expect(calls.at(-1)?.[1]).toBe(
      "repos/{owner}/{repo}/compare/main...ork/r1",
    );
  });

  it("says why gh couldn't read a ref, and leaves it waiting", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef);
    const { gh } = ghFrom({});
    const result = await checkFollowUpsDue({ rows: store, project: HERE, gh });
    expect(result.errors).toEqual(["gh failed: unexpected"]);
    expect(store.followUps(HERE)[0]?.status).toBe("waiting");
  });

  it("makes dated follow-ups due on their date", async () => {
    const store = openStore(":memory:");
    await keep(
      store,
      { ...change, due: "2026-11-12" },
      { ...change, title: "Later", due: "2026-11-13" },
    );
    const result = await checkFollowUpsDue({
      rows: store,
      project: HERE,
      gh: ghFrom({}).gh,
      now: () => new Date(2026, 10, 12, 9),
    });
    expect(result.due.map(f => f.due)).toEqual(["2026-11-12"]);
  });

  it("runs on a schedule and hears what came due", async () => {
    const store = openStore(":memory:");
    await keep(store, withRef);
    const heard: string[] = [];
    const stop = startFollowUpChecks({
      rows: store,
      gh: ghFrom(prState("MERGED")).gh,
      projects: () => [HERE],
      onDue: due => {
        heard.push(...due.map(f => f.title));
      },
      everyMs: 60_000,
    });
    await vi.waitFor(() => {
      expect(heard).toEqual([change.title]);
    });
    stop();
  });
});

/** No run is live. */
const never = (): boolean => false;

describe("markDue, recordPublished and takeFollowUps", () => {
  it("makes one due by its id, or all a run left", async () => {
    const store = openStore(":memory:");
    await keep(
      store,
      { ...change, due: "after-deploy" },
      {
        ...change,
        title: "Check the dashboard",
        for: "me",
        due: "after-deploy",
      },
    );
    expect(markDue(store, HERE, idAt(store, 0)).length).toBe(1);
    expect(markDue(store, HERE, "r1").map(f => f.title)).toEqual([
      "Check the dashboard",
    ]);
    expect(markDue(store, HERE, "nothing")).toEqual([]);
  });

  it("records a run's published ref, and finishes what it took", async () => {
    const store = openStore(":memory:");
    await keep(store, change, { ...change, title: "Taken", from: {} });
    const taken = idAt(store, 1);
    expect(
      takeFollowUps(store, {
        project: HERE,
        run: "r2",
        ids: [taken],
        isLive: never,
      }).taken.length,
    ).toBe(1);
    const published = recordPublished(store, {
      project: HERE,
      run: "r1",
      ref: "ork/r1",
    });
    expect(published.referenced.map(f => f.ref)).toEqual(["ork/r1"]);
    const finished = recordPublished(store, {
      project: HERE,
      run: "r2",
      ref: "ork/r2",
    });
    expect(finished.done.map(f => [f.title, f.status])).toEqual([
      ["Taken", "done"],
    ]);
  });

  it("finishes what a run that called the publishing one took", async () => {
    const store = openStore(":memory:");
    await keep(store, change);
    takeFollowUps(store, {
      project: HERE,
      run: "start1",
      ids: [idAt(store, 0)],
      isLive: never,
    });
    const published = recordPublished(store, {
      project: HERE,
      run: "build1",
      ref: "ork/b",
      callers: ["start1"],
    });
    expect(published.done.map(f => f.status)).toEqual(["done"]);
  });

  it("takes only open follow-ups for an agent", async () => {
    const store = openStore(":memory:");
    await keep(store, { ...change, for: "me" });
    const mine = idAt(store, 0);
    const result = takeFollowUps(store, {
      project: HERE,
      run: "r2",
      ids: [mine, "nope"],
      isLive: never,
    });
    expect(result.taken).toEqual([]);
    expect(result.refused).toEqual([
      `${mine}: it is for me`,
      "nope: there is no such follow-up",
    ]);
  });
});

const heldByLive1 = async () => {
  const store = openStore(":memory:");
  await keep(
    store,
    { ...change, due: "now" },
    { ...change, due: "now", title: "Second" },
  );
  const [one, two] = [idAt(store, 0), idAt(store, 1)];
  takeFollowUps(store, {
    project: HERE,
    run: "live1",
    ids: [one],
    isLive: never,
  });
  return { store, one, two };
};

const live1 = (id: string): boolean => id === "live1";

/** A run the store has no record of, and the clock a minute or three on. */
const unknown = (): undefined => undefined;
const soon = (): string => new Date(Date.now() + 60_000).toISOString();
const later = (): string => new Date(Date.now() + 3 * 60_000).toISOString();

/** `heldNote` of the follow-up `id`, for a liveness answer and a clock. */
const noteOf =
  (store: EventStore, id: string) =>
  (isLive: RunLive, now: number): string | undefined => {
    const f = store.followUp(HERE, id);
    return f === undefined ? "no such follow-up" : heldNote(f, isLive, now);
  };

describe("a follow-up a live run took", () => {
  it("is refused by an explicit take, until that run is no longer live", async () => {
    const { store, one } = await heldByLive1();
    const refused = takeFollowUps(store, {
      project: HERE,
      run: "r2",
      ids: [one],
      isLive: live1,
    });
    expect(refused.taken).toEqual([]);
    expect(refused.refused).toEqual([
      `${one}: taken by run live1, still running`,
    ]);
    const again = takeFollowUps(store, {
      project: HERE,
      run: "r2",
      ids: [one],
      isLive: never,
    });
    expect(again.taken.map(f => f.takenBy)).toEqual(["r2"]);
  });

  it("is left out of the due ones, and named as held", async () => {
    const { store, one, two } = await heldByLive1();
    const found = availableDue(store, HERE, live1);
    expect(found.ids).toEqual([two]);
    expect(found.held.map(f => f.id)).toEqual([one]);
    expect(availableDue(store, HERE, never).ids).toEqual([one, two]);
  });

  it("is held for two minutes by a run the store does not know yet", async () => {
    const { store, one, two } = await heldByLive1();
    expect(availableDue(store, HERE, unknown, "", soon).ids).toEqual([two]);
    expect(availableDue(store, HERE, unknown, "", later).ids).toEqual([
      one,
      two,
    ]);
    const refused = takeFollowUps(
      store,
      { project: HERE, run: "r2", ids: [one], isLive: unknown },
      soon,
    );
    expect(refused.refused).toEqual([
      `${one}: taken by run live1, not started yet; free in under 2 minutes`,
    ]);
  });

  it("is noted as running, not started yet, or free (heldNote)", async () => {
    const { store, one } = await heldByLive1();
    const note = noteOf(store, one);
    expect(note(live1, Date.now())).toBe("still running");
    expect(note(unknown, Date.parse(soon()))).toBe(
      "not started yet; free in under 2 minutes",
    );
    expect(note(unknown, Date.parse(later()))).toBeUndefined();
    expect(note(never, Date.now())).toBeUndefined();
  });

  it("is not held against the run that took it", async () => {
    const { store, one } = await heldByLive1();
    expect(availableDue(store, HERE, () => true, "live1").ids).toContain(one);
  });
});

describe("postFollowUpMessage", () => {
  const message: NewFollowUp = {
    ...change,
    for: "person:Dana",
    kind: "message",
    due: "now",
    draft: {
      to: "https://github.com/acme/web/pull/7",
      channel: "github",
      text: `Notes in ${HOME}/notes.md`,
    },
  };

  const kept = async () => {
    const store = openStore(":memory:");
    await keep(store, message);
    const [f] = store.followUps(HERE);
    if (f === undefined) throw new Error("not kept");
    return { store, f };
  };

  it("posts nothing until the maintainer confirms", async () => {
    const { store, f } = await kept();
    const { gh, calls } = ghFrom({});
    const result = await postFollowUpMessage(f, {
      rows: store,
      gh,
      confirmed: false,
      home: HOME,
    });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("comments on the PR with the scrubbed draft, and marks it done", async () => {
    const { store, f } = await kept();
    const { gh, calls } = ghFrom({
      "pr comment": ok("https://github.com/acme/web/pull/7#issuecomment-1\n"),
    });
    const result = await postFollowUpMessage(f, {
      rows: store,
      gh,
      confirmed: true,
      home: HOME,
    });
    expect(result).toMatchObject({
      ok: true,
      url: "https://github.com/acme/web/pull/7#issuecomment-1",
    });
    expect(calls).toEqual([
      ["pr", "comment", message.draft?.to, "--body", "Notes in ~/notes.md"],
    ]);
    expect(store.followUps(HERE)[0]?.status).toBe("done");
  });

  it("leaves other channels to the maintainer", async () => {
    const { store, f } = await kept();
    const result = await postFollowUpMessage(
      { ...f, draft: { to: "Dana", channel: "email", text: "Hi" } },
      { rows: store, gh: ghFrom({}).gh, confirmed: true, home: HOME },
    );
    expect(result).toMatchObject({ ok: false });
  });

  it.each(["142", "#142", "Dana", "https://github.com/acme/web"])(
    "runs no gh for a github draft whose `to` is %j",
    async to => {
      const { store, f } = await kept();
      const { gh, calls } = ghFrom({});
      const result = await postFollowUpMessage(
        { ...f, draft: { to, channel: "github", text: "Hi" } },
        { rows: store, gh, confirmed: true, home: HOME },
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toMatch(
        /isn't a GitHub issue or pull request URL/u,
      );
      expect(calls).toEqual([]);
    },
  );
});
