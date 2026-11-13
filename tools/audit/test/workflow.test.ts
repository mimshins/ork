/**
 * @file Tests `.ork/workflows/audit.ork.yaml` against the plan: it loads with
 *   Ork's schema, every agent node is `readonly` and reads the read-only Bash
 *   rule, the node budgets times each profile's counts stay under that
 *   profile's cap (and the file's numbers are the ones `profiles.ts` sums), the
 *   `forEach` caps cover the profiles' counts, the description shows the sums,
 *   `recheck` runs only under `standard`, the edges out of `findings` need `ok`
 *   (so a failing validator ends the run), the validators run in `tool.shell`
 *   nodes under the default `sh -eu`, and a bad recon payload stops `ledger`.
 *   The workflow also compiles as `ork validate` does.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileWorkflow } from "../../../packages/core/src/index.ts";
import { parseWorkflow } from "../../../packages/schema/src/index.ts";
import {
  maxSpendUsd,
  NODE_BUDGETS_USD,
  PROFILES,
  type ProfileName,
} from "../profiles.ts";
import { auditEnv, cleanUp } from "./kit.ts";

const load = () => {
  const text = readFileSync(
    path.resolve(import.meta.dirname, "../../../.ork/workflows/audit.ork.yaml"),
    "utf8",
  );
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error("audit.ork.yaml does not load");
  return result.workflow;
};

const workflow = load();

afterEach(cleanUp);

type Node = (typeof workflow.nodes)[string];

const agents = (): [string, Node][] =>
  Object.entries(workflow.nodes).filter(([, node]) =>
    node.type.startsWith("agent."),
  );

const field = (name: string, key: string): unknown =>
  Reflect.get(workflow.nodes[name] ?? {}, key);

const budgetOf = (name: string): unknown => field(name, "budgetUsd");

const maxItemsOf = (name: string): unknown =>
  Reflect.get(
    Reflect.get(workflow.nodes[name] ?? {}, "forEach") ?? {},
    "maxItems",
  );

const scriptOf = (name: string): string => {
  const script = field(name, "script");
  return typeof script === "string" ? script : "";
};

const whensTo = (from: string): string[] =>
  (workflow.edges ?? []).flatMap(edge => {
    // A plain edge is written as "a -> b" and has no condition.
    const when: unknown =
      typeof edge === "string" ? undefined : Reflect.get(edge, "when");
    const source: unknown =
      typeof edge === "string" ? undefined : Reflect.get(edge, "from");
    return source === from && typeof when === "string" ? [when] : [];
  });

/** Runs a node's script as Ork does by default (`sh -eu`), from the checkout. */
const runScript = (name: string, env: Record<string, string>) =>
  spawnSync("sh", ["-eu", "-c", scriptOf(name)], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("audit.ork.yaml", () => {
  it("has agent nodes that are all readonly and read the read-only Bash rule", () => {
    expect(agents().length).toBeGreaterThan(0);
    for (const [, node] of agents()) {
      expect(Reflect.get(node, "isolation")).toBe("readonly");
      expect(Reflect.get(node, "context")).toContain(
        "../context/read-only-bash.md",
      );
    }
  });

  it("uses the budgets profiles.ts sums", () => {
    for (const [name, usd] of Object.entries(NODE_BUDGETS_USD)) {
      expect(budgetOf(name)).toBe(usd);
    }
  });

  it.each(["quick", "standard"] as const)(
    "keeps %s under its cap, and the forEach caps cover its counts",
    (profile: ProfileName) => {
      expect(maxSpendUsd(profile)).toBeLessThanOrEqual(
        PROFILES[profile].capUsd,
      );
      expect(Number(maxItemsOf("hunt"))).toBeGreaterThanOrEqual(
        PROFILES[profile].hunters,
      );
      expect(Number(maxItemsOf("verify"))).toBeGreaterThanOrEqual(
        PROFILES[profile].verifiers,
      );
      expect(Number(maxItemsOf("recheck"))).toBeGreaterThanOrEqual(
        PROFILES[profile].rechecks,
      );
    },
  );

  it("caps the run at the larger profile and shows both sums", () => {
    expect(workflow.limits?.budgetUsd).toBe(PROFILES.standard.capUsd);
    expect(workflow.description).toContain(`$${maxSpendUsd("quick")}`);
    expect(workflow.description).toContain(`$${maxSpendUsd("standard")}`);
  });

  it("runs recheck only under standard", () => {
    expect(workflow.edges).toContainEqual({
      from: "findings",
      to: "recheck",
      when: "ok && inputs.profile == 'standard'",
    });
  });

  it("uses Opus for recon, hunt and verify", () => {
    const models = ["recon", "hunt", "verify"].map(name =>
      field(name, "model"),
    );
    expect(models).toEqual([
      "claude-code.opus",
      "claude-code.opus",
      "claude-code.opus",
    ]);
  });

  it("takes each edge out of findings only when findings succeeded", () => {
    const whens = [...whensTo("findings")];
    expect(whens).toEqual([
      "ok && inputs.profile == 'standard'",
      "ok && inputs.profile == 'quick'",
    ]);
  });

  it("compiles with no error, as ork validate does", () => {
    const { diagnostics } = compileWorkflow(workflow);
    expect(diagnostics.filter(item => item.severity === "error")).toEqual([]);
  });

  it("runs both validators in tool.shell nodes under the default sh -eu", () => {
    expect(scriptOf("ledger")).toContain("validate-coverage-ledger.cjs");
    expect(scriptOf("findings")).toContain("validate-findings.cjs");
    expect(scriptOf("finalize")).toContain("validate-findings.cjs");
    const nodes = ["ledger", "findings", "finalize"];
    expect(nodes.map(name => field(name, "type"))).toEqual([
      "tool.shell",
      "tool.shell",
      "tool.shell",
    ]);
    expect(nodes.map(name => field(name, "interpreter"))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("has no script that swallows a failure", () => {
    const names = Object.keys(workflow.nodes);
    expect(names.filter(name => scriptOf(name).includes("|| true"))).toEqual(
      [],
    );
  });

  it("stops the ledger step on a bad recon payload, with the message", () => {
    const result = runScript(
      "ledger",
      auditEnv({ PROFILE: "quick", SCOPE: "all", UNITS: '[{"surface":"s"}]' }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("recon unit 1");
  });
});
