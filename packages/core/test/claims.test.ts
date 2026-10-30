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
  harnessInstructions,
  type HumanChannel,
  type NodeExecutor,
  normalizeResource,
  overlaps,
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
  "  api: { type: claude.worker, prompt: a }",
  "  ui: { type: claude.worker, prompt: u }",
  "  review: { type: claude.worker, prompt: r, isolation: readonly }",
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
      compile(["nodes:", "  api: { type: claude.worker, prompt: a }"]),
    );
    expect(alone.claims.port("api", undefined, "/r").contended()).toBe(false);
  });

  it("counts the workers a leader may spawn", () => {
    const { claims } = setup(
      compile([
        "nodes:",
        "  lead: { type: claude.leader, prompt: l, maxWorkers: 2, isolation: readonly }",
        "  fix: { type: claude.worker, parent: lead, prompt: f }",
      ]),
    );
    expect(claims.port("fix-2", "fix", "/r").contended()).toBe(true);
    expect(claims.port("lead", undefined, "/r").contended()).toBe(false);
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
      "  api: { type: claude.worker, prompt: a, isolation: shared }",
      "  ui: { type: claude.worker, prompt: u, isolation: shared }",
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
        "claude.worker": worker,
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
