/**
 * @file Tests for the claim tools on the run's real claims: who gets `claim`
 *   and `release`, and what each says back to the session.
 */

import {
  compileWorkflow,
  createClaims,
  type HumanChannel,
} from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { handleRpc, orkTools } from "../src/index.ts";

const parsed = parseWorkflow(
  [
    "schemaVersion: 1",
    "name: t",
    "nodes:",
    "  api: { type: claude.worker, prompt: a }",
    "  ui: { type: claude.worker, prompt: u }",
    "  review: { type: claude.worker, prompt: r, isolation: readonly }",
  ].join("\n"),
);
if (!parsed.ok) throw new Error("bad fixture");
const { graph } = compileWorkflow(parsed.workflow);
if (graph === null) throw new Error("bad fixture");

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: true }),
};

const claims = createClaims({
  graph,
  onEvent: () => {
    // Events are the claims' own tests' concern.
  },
  notify: () => {
    // So are notices.
  },
});

const tools = (nodeId: string) =>
  orkTools({
    nodeId,
    driver: "sdk",
    ports: { human, claims: claims.port(nodeId, undefined, "/repo") },
  });

/** Calls one tool over JSON-RPC and returns its text. */
const call = async (nodeId: string, name: string, resource: string) =>
  JSON.stringify(
    await handleRpc(tools(nodeId), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: { resource } },
    }),
  );

describe("the claim tools", () => {
  it("go to nodes that may write while another does", () => {
    expect(tools("api").map(t => t.name)).toEqual([
      "ask_user",
      "claim",
      "release",
    ]);
    expect(tools("review").map(t => t.name)).toEqual(["ask_user"]);
  });

  it("claim, refuse with who holds it, and release", async () => {
    expect(await call("api", "claim", "src/")).toContain("Claimed src.");
    expect(await call("api", "claim", "src/a.ts")).toContain(
      "You already hold src/a.ts.",
    );
    expect(await call("ui", "claim", "/repo/src/a.ts")).toContain(
      "Not claimed: api holds src, which overlaps src/a.ts.",
    );
    expect(await call("ui", "release", "src")).toContain(
      "Not released: you hold no claim on src; you hold none.",
    );
    expect(await call("api", "release", "src")).toContain("Released src.");
    expect(await call("ui", "claim", "src/a.ts")).toContain(
      "Claimed src/a.ts.",
    );
  });
});
