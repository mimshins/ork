/**
 * @file Tests for the run's claims: how resources compare (paths from the
 *   project root, folders covering what is in them, names), who gets the tools,
 *   a second claimant told who holds what and told again when it is released,
 *   and claims released when a node finishes, in a real run.
 */

import { isClaudeNode, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type ClaimResult,
  compileWorkflow,
  createClaims,
  type CompiledGraph,
  type Delegation,
  harnessInstructions,
  type HumanChannel,
  type NodeExecutor,
  normalizeResource,
  overlaps,
  type Ownership,
  type RunEvent,
  startRun,
} from "../src/index.ts";

const compile = (lines: string[]): CompiledGraph => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph, diagnostics } = compileWorkflow(parsed.workflow);
  if (graph === null) throw new Error(JSON.stringify(diagnostics));
  return graph;
};

/** Two writers and a reviewer, side by side. */
const PAIR = compile([
  "nodes:",
  "  api: { type: agent.worker, prompt: a }",
  "  ui: { type: agent.worker, prompt: u }",
  "  review: { type: agent.worker, prompt: r, isolation: readonly }",
]);

const setup = (graph: CompiledGraph = PAIR) => {
  const events: RunEvent[] = [];
  const told: [string, string][] = [];
  const claims = createClaims({
    graph,
    onEvent: event => {
      events.push(event);
    },
    notify: (node, text) => {
      told.push([node, text]);
    },
  });
  return { claims, events, told };
};

describe("resources", () => {
  it("are paths from the project root, or names", () => {
    expect(normalizeResource("./src/auth/", "/repo")).toBe("src/auth");
    expect(normalizeResource("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(normalizeResource("/repo", "/repo")).toBe(".");
    expect(normalizeResource("/elsewhere/x", "/repo")).toBe("/elsewhere/x");
    expect(normalizeResource(" db:migrations ", "/repo")).toBe("db:migrations");
  });

  it("overlap when the same, or when one is a folder holding the other", () => {
    expect(overlaps("src", "src/a.ts")).toBe(true);
    expect(overlaps("src/a.ts", "src")).toBe(true);
    expect(overlaps(".", "docs")).toBe(true);
    expect(overlaps("src", "srcs/a.ts")).toBe(false);
    expect(overlaps("db:migrations", "db:seeds")).toBe(false);
  });
});

describe("who gets the tools", () => {
  it("nodes that may write while another does; reviewers never", () => {
    const { claims } = setup();
    expect(claims.port("api", undefined, "/r").contended()).toBe(true);
    expect(claims.port("review", undefined, "/r").contended()).toBe(false);
    const alone = setup(
      compile(["nodes:", "  api: { type: agent.worker, prompt: a }"]),
    );
    expect(alone.claims.port("api", undefined, "/r").contended()).toBe(false);
  });

  it("counts the workers a leader may spawn", () => {
    const { claims } = setup(
      compile([
        "nodes:",
        "  lead: { type: agent.leader, prompt: l, maxWorkers: 2, isolation: readonly }",
        "  fix: { type: agent.worker, parent: lead, prompt: f }",
      ]),
    );
    expect(claims.port("fix-2", "fix", "/r").contended()).toBe(true);
    expect(claims.port("lead", undefined, "/r").contended()).toBe(false);
  });

  it("counts a fanned writer's items as writers beside each other", () => {
    const { claims } = setup(
      compile([
        "nodes:",
        "  build: { type: agent.worker, prompt: b, isolation: shared, forEach: { items: [a, b] } }",
      ]),
    );
    expect(claims.port("build.0", "build", "/r").contended()).toBe(true);
  });
});

/** The harness instructions of a node of PAIR, given its claims. */
const instructions = (id: string) => {
  const node = PAIR.nodes.get(id)?.node;
  if (node === undefined || !isClaudeNode(node)) throw new Error(id);
  const { claims } = setup();
  return harnessInstructions(PAIR.workflow, id, node, {
    claims: claims.port(id, undefined, "/r"),
  });
};

describe("the harness instructions", () => {
  it("tell a node to claim only when another may write at the same time", () => {
    expect(instructions("api")).toContain("`claim` it");
    expect(instructions("review")).not.toContain("`claim`");
  });
});

describe("claiming", () => {
  it("tells the second claimant who holds it, then that it was released", () => {
    const { claims, events, told } = setup();
    const api = claims.port("api", undefined, "/w/api");
    const ui = claims.port("ui", undefined, "/w/ui");
    expect(api.claim("/w/api/src/auth/")).toEqual({
      ok: true,
      resource: "src/auth",
      already: false,
    });
    expect(api.claim("src/auth/login.ts")).toMatchObject({ already: true });
    const refused = ui.claim("src/auth/login.ts");
    expect(refused).toEqual({
      ok: false,
      error:
        "api holds src/auth, which overlaps src/auth/login.ts. Work on something else, or ask api if you can reach it; Ork tells you when it is released",
    });
    expect(ui.claim("src/ui")).toMatchObject({ ok: true });
    expect(ui.release("src/auth")).toEqual({
      ok: false,
      error: "you hold no claim on src/auth; you hold src/ui",
    });
    expect(api.release("src/auth")).toMatchObject({ ok: true });
    expect(told).toEqual([
      [
        "ui",
        "[ork] src/auth was released by api. Claim what you need again before you change it.",
      ],
    ]);
    expect(ui.claim("src/auth/login.ts")).toMatchObject({ ok: true });
    expect(events.map(e => e.type)).toEqual([
      "claim.taken",
      "claim.refused",
      "claim.taken",
      "claim.released",
      "claim.taken",
    ]);
  });

  it("releases what a node holds when it finishes", () => {
    const { claims, events, told } = setup();
    claims.port("api", undefined, "/r").claim("src");
    claims.port("ui", undefined, "/r").claim("src/x");
    claims.releaseAll("ui");
    claims.releaseAll("api");
    expect(told).toEqual([]);
    expect(events.at(-1)).toEqual({
      type: "claim.released",
      node: "api",
      resource: "src",
      reason: "finished",
    });
  });
});

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "stop"),
  permit: () => Promise.resolve({ allow: true }),
};

/**
 * Workers running side by side: `api` claims `src` and holds it until `ui` has
 * tried to claim a file in it.
 */
const claimingWorkers = () => {
  const { promise: uiTried, resolve: tried } =
    Promise.withResolvers<ClaimResult>();
  const worker: NodeExecutor = async ({ id, claims }) => {
    if (id === "api") {
      claims?.claim("src");
      await uiTried;
    } else tried(claims?.claim("src/app.ts") ?? { ok: false, error: "" });
    return { ok: true, output: { status: "pass" } };
  };
  return { worker, uiTried };
};

describe("claims in a run", () => {
  it("refuses a parallel node and frees the claim when its holder ends", async () => {
    const graph = compile([
      "nodes:",
      "  start: { type: tool.shell, command: s }",
      "  api: { type: agent.worker, prompt: a, isolation: shared }",
      "  ui: { type: agent.worker, prompt: u, isolation: shared }",
      "edges:",
      "  - start -> api, ui",
    ]);
    const { worker, uiTried } = claimingWorkers();
    const events: RunEvent[] = [];
    const { done } = startRun({
      graph,
      inputs: {},
      cwd: import.meta.dirname,
      executors: {
        "tool.shell": () => Promise.resolve({ ok: true, output: {} }),
        "agent.worker": worker,
      },
      human,
      onEvent: event => {
        events.push(event);
      },
    });
    expect((await done).status).toBe("succeeded");
    expect(await uiTried).toMatchObject({ ok: false });
    expect(events.filter(e => e.type.startsWith("claim."))).toEqual([
      { type: "claim.taken", node: "api", resource: "src" },
      {
        type: "claim.refused",
        node: "ui",
        resource: "src/app.ts",
        holder: "api",
        held: "src",
      },
      {
        type: "claim.released",
        node: "api",
        resource: "src",
        reason: "finished",
      },
    ]);
  });
});

/**
 * A leader with three children (`busy` also runs in the flow), and a worker
 * beside it outside its team.
 */
const OWNED = compile([
  "limits: { concurrency: 4 }",
  "nodes:",
  "  start: { type: tool.shell, command: s }",
  "  lead: { type: agent.leader, maxWorkers: 1 }",
  "  fix: { type: agent.worker, parent: lead }",
  "  check: { type: agent.worker, parent: lead }",
  "  busy: { type: agent.worker, parent: lead }",
  "  other: { type: agent.worker }",
  "edges:",
  "  - start -> lead, other, busy",
]);

type Behavior = (context: Parameters<NodeExecutor>[0]) => Promise<unknown>;

/** Runs OWNED; each node, or spawned instance by template, does its behavior. */
const runOwned = async (behaviors: Record<string, Behavior>) => {
  const events: RunEvent[] = [];
  const executor: NodeExecutor = async context => {
    await behaviors[context.template ?? context.id]?.(context);
    return { ok: true, output: { status: "pass" } };
  };
  const result = await startRun({
    graph: OWNED,
    inputs: {},
    cwd: import.meta.dirname,
    executors: {
      "tool.shell": () => Promise.resolve({ ok: true, output: {} }),
      "agent.leader": executor,
      "agent.worker": executor,
    },
    human,
    onEvent: event => {
      events.push(event);
    },
  }).done;
  return { result, events };
};

type Start = (own: Ownership | undefined) => Promise<Delegation | undefined>;

const viaDelegate: Start = own =>
  Promise.resolve(own?.delegate([{ child: "fix", brief: "go" }]));
const viaSpawn: Start = own =>
  Promise.resolve(own?.spawn([{ template: "fix", brief: "go" }]));

const claimEvents = (events: RunEvent[]) =>
  events.filter(e => e.type.startsWith("claim."));

/** Claims given up by hand, not because their node finished. */
const releasedEarly = (events: RunEvent[]) =>
  events.filter(e => e.type === "claim.released" && e.reason === "released");

/** What `fix` gets claiming `wanted`, once its leader holding `held` starts it. */
const childClaim = async (start: Start, held: string, wanted: string) => {
  let tried: ClaimResult | undefined;
  await runOwned({
    lead: async ({ claims, ownership }) => {
      claims?.claim(held);
      await start(ownership);
    },
    fix: ({ claims }) => {
      tried = claims?.claim(wanted);
      return Promise.resolve();
    },
  });
  return tried;
};

/** What the leader sees of a call that rejects every task it gives. */
const rejectedByAll = async () => {
  const { promise: running, resolve: isRunning } =
    Promise.withResolvers<void>();
  const { promise: done, resolve: finish } = Promise.withResolvers<void>();
  let delegation: Delegation | undefined;
  let held: string[] | undefined;
  const { events } = await runOwned({
    busy: async () => {
      isRunning();
      await done;
    },
    lead: async ({ claims, ownership }) => {
      await running;
      claims?.claim("src");
      delegation = await ownership?.delegate([
        { child: "other", brief: "not mine" },
        { child: "busy", brief: "already running" },
      ]);
      held = claims?.held();
      finish();
    },
  });
  return { delegation, held, events };
};

/** Two children of a leader holding `src` both go for `src`. */
const siblingsContend = async () => {
  const { promise: holding, resolve: holds } = Promise.withResolvers<void>();
  const { promise: tried, resolve: triedIt } = Promise.withResolvers<void>();
  const { promise: notice, resolve: told } = Promise.withResolvers<string>();
  let first: ClaimResult | undefined;
  let second: ClaimResult | undefined;
  await runOwned({
    lead: async ({ claims, ownership }) => {
      claims?.claim("src");
      await ownership?.delegate([
        { child: "fix", brief: "a" },
        { child: "check", brief: "b" },
      ]);
    },
    fix: async ({ claims }) => {
      first = claims?.claim("src");
      holds();
      await tried;
      claims?.release("src");
    },
    check: async ({ claims, mailbox }) => {
      mailbox?.connect(told);
      await holding;
      second = claims?.claim("src");
      triedIt();
      await notice;
    },
  });
  return { first, second, notice: await notice };
};

/** `fix` asks for a path that `other`, outside the leader's team, holds. */
const outsiderHolds = async () => {
  const { promise: holding, resolve: holds } = Promise.withResolvers<void>();
  const { promise: tried, resolve: triedIt } = Promise.withResolvers<
    ClaimResult | undefined
  >();
  const { events } = await runOwned({
    other: async ({ claims }) => {
      claims?.claim("lib");
      holds();
      await tried;
    },
    lead: async ({ ownership }) => {
      await holding;
      await viaDelegate(ownership);
    },
    fix: ({ claims }) => {
      triedIt(claims?.claim("lib/a.ts"));
      return Promise.resolve();
    },
  });
  return { tried: await tried, events };
};

/** The leader holds two paths, waits for `fix`, then claims one back. */
const leaderClaimsAgain = async (start: Start) => {
  let delegation: Delegation | undefined;
  let again: ClaimResult | undefined;
  const { events } = await runOwned({
    lead: async ({ claims, ownership }) => {
      claims?.claim("src");
      claims?.claim("README.md");
      delegation = await start(ownership);
      again = claims?.claim("src");
    },
  });
  return { delegation, again, events };
};

const BOTH_TOOLS = [
  { tool: "delegate", start: viaDelegate },
  { tool: "spawn_worker", start: viaSpawn },
];

describe("a leader's claims and its children", () => {
  it.each(
    BOTH_TOOLS.flatMap(via => [
      { ...via, held: "src", wanted: "src" },
      { ...via, held: "src", wanted: "src/x" },
      { ...via, held: ".", wanted: "src" },
    ]),
  )(
    "$tool: a leader holding $held does not refuse its child $wanted",
    async ({ start, held, wanted }) => {
      expect(await childClaim(start, held, wanted)).toMatchObject({
        ok: true,
        resource: wanted,
      });
    },
  );

  it("still refuses a child a path held outside the leader's team", async () => {
    const { tried, events } = await outsiderHolds();
    expect(tried).toEqual({
      ok: false,
      error:
        "other holds lib, which overlaps lib/a.ts. Work on something else, or ask other if you can reach it; Ork tells you when it is released",
    });
    expect(events).toContainEqual({
      type: "claim.refused",
      node: "fix",
      resource: "lib/a.ts",
      holder: "other",
      held: "lib",
    });
  });

  it("keeps two children of one leader contending", async () => {
    const { first, second, notice } = await siblingsContend();
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual({
      ok: false,
      error:
        "fix holds src. Work on something else, or ask fix if you can reach it; Ork tells you when it is released",
    });
    expect(notice).toBe(
      "[ork] src was released by fix. Claim what you need again before you change it.",
    );
  });

  it.each(BOTH_TOOLS)(
    "$tool: tells the leader what it released, and it can claim again",
    async ({ start }) => {
      const { delegation, again, events } = await leaderClaimsAgain(start);
      expect(delegation?.notes).toEqual([
        "Your claims on `src`, `README.md` were released while your children worked; claim again before you edit.",
      ]);
      expect(again).toEqual({ ok: true, resource: "src", already: false });
      expect(claimEvents(events)).toEqual([
        { type: "claim.taken", node: "lead", resource: "src" },
        { type: "claim.taken", node: "lead", resource: "README.md" },
        {
          type: "claim.released",
          node: "lead",
          resource: "src",
          reason: "released",
        },
        {
          type: "claim.released",
          node: "lead",
          resource: "README.md",
          reason: "released",
        },
        { type: "claim.taken", node: "lead", resource: "src" },
        {
          type: "claim.released",
          node: "lead",
          resource: "src",
          reason: "finished",
        },
      ]);
    },
  );

  it("leaves the claims alone when every task is rejected", async () => {
    const { delegation, held, events } = await rejectedByAll();
    expect(delegation?.reports.map(r => r.ok)).toEqual([false, false]);
    expect(delegation?.notes).toEqual([]);
    expect(held).toEqual(["src"]);
    expect(releasedEarly(events)).toEqual([]);
  });

  it("adds no note for a leader that holds nothing", async () => {
    let delegation: Delegation | undefined;
    const { events } = await runOwned({
      lead: async ({ ownership }) => {
        delegation = await viaDelegate(ownership);
      },
    });
    expect(delegation?.notes).toEqual([]);
    expect(claimEvents(events)).toEqual([]);
  });
});
