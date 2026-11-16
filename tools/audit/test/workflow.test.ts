/**
 * @file Tests the built-in `security-audit.ork.yaml` (the source in
 *   `packages/core/workflows/`) against the plan: it loads with Ork's schema,
 *   every agent node is `readonly` and reads the read-only Bash rule, the node
 *   budgets times each profile's counts stay under that profile's cap (and the
 *   file's numbers are the ones `profiles.ts` sums), the `forEach` caps cover
 *   the profiles' counts, the description shows the sums, `recheck` runs only
 *   under `standard`, the edges out of `findings` need `ok` (so a failing
 *   validator ends the run), the validators run in `tool.shell` nodes under the
 *   default `sh -eu`, and a bad recon payload stops `ledger`. The workflow also
 *   compiles as `ork validate` does.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUNDLE_DIR_PLACEHOLDER,
  compileWorkflow,
} from "../../../packages/core/src/index.ts";
import { parseWorkflow } from "../../../packages/schema/src/index.ts";
import {
  maxSpendUsd,
  NODE_BUDGETS_USD,
  PROFILES,
  type ProfileName,
} from "../profiles.ts";
import {
  auditEnv,
  bundleProject,
  cleanUp,
  confirmed,
  readJson,
  reconUnits,
} from "./kit.ts";

const load = () => {
  const text = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../packages/core/workflows/security-audit.ork.yaml",
    ),
    "utf8",
  );
  const result = parseWorkflow(text);
  if (!result.ok) throw new Error("security-audit.ork.yaml does not load");
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

/**
 * Runs a node's script as Ork does by default (`sh -eu`), from the root of a
 * project that has the bundle written into it, with the placeholder replaced as
 * Ork does when it writes the workflow.
 */
const runScript = (
  name: string,
  env: Record<string, string>,
  project = bundleProject(),
) => {
  return spawnSync(
    "sh",
    [
      "-eu",
      "-c",
      scriptOf(name).replaceAll(BUNDLE_DIR_PLACEHOLDER, project.relative),
    ],
    { cwd: project.repo, encoding: "utf8", env: { ...process.env, ...env } },
  );
};

describe("security-audit.ork.yaml", () => {
  it("has agent nodes that are all readonly and read the bundled read-only Bash rule", () => {
    expect(agents().length).toBeGreaterThan(0);
    for (const [, node] of agents()) {
      expect(Reflect.get(node, "isolation")).toBe("readonly");
      expect(Reflect.get(node, "context")).toContain(
        "./security-audit/context/read-only-bash.md",
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

  it.each([
    ["failed", "", true],
    ["answered", "false", undefined],
  ])(
    "consolidates after a critic that %s, marking a missing critique",
    (_how, stop, missing) => {
      expect(whensTo("critic")).toEqual(["ok || !ok"]);
      const env = auditEnv({ PROFILE: "quick", SCOPE: "all" });
      const project = bundleProject();
      const ledger = runScript(
        "ledger",
        { ...env, UNITS: JSON.stringify(reconUnits(2)) },
        project,
      );
      expect(ledger.status).toBe(0);
      const result = runScript(
        "consolidate",
        { ...env, HUNTS: "[]", GAPS: "", CRITIC_STOP: stop },
        project,
      );
      expect(result.status).toBe(0);
      const printed: unknown = JSON.parse(result.stdout);
      const outputDir = String(
        Reflect.get(Object.assign({}, printed), "outputDir"),
      );
      expect(
        Reflect.get(
          Object.assign({}, readJson(outputDir, "run-metadata.json")),
          "coverage_critique_missing",
        ),
      ).toBe(missing);
    },
  );

  it("holds each verifier's record to the schema with a verify: step", () => {
    const verify = Object.assign({}, field("verify", "verify"));
    expect(Reflect.get(verify, "attempts")).toBe(3);
    const script = String(Reflect.get(verify, "script"));
    expect(script).toContain('cli.ts" check-record');
    // The resumes it sends spend the node's own cap, which the sums count.
    expect(budgetOf("verify")).toBe(0.5);
    const project = bundleProject();
    const record = confirmed("fp-1");
    const run = (report: unknown) => {
      const file = path.join(project.repo, "..", "verify.1.report.json");
      writeFileSync(file, JSON.stringify(report));
      return spawnSync(
        "sh",
        [
          "-eu",
          "-c",
          script.replaceAll(BUNDLE_DIR_PLACEHOLDER, project.relative),
        ],
        {
          cwd: project.repo,
          encoding: "utf8",
          env: {
            ...process.env,
            ...auditEnv({ ORK_REPORT: file }),
          },
        },
      );
    };
    const bad = run({
      decision: "confirmed",
      records: [{ ...record, scope_note: "x" }],
    });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("`scope_note`");
    const fixed = run({ decision: "confirmed", records: [record] });
    expect(fixed.stderr).toBe("");
    expect(fixed.status).toBe(0);
  });

  it("tells ledger the previous audit's folder scan found", () => {
    expect(
      Reflect.get(Object.assign({}, field("ledger", "env")), "PREVIOUS"),
    ).toBe("{{nodes.scan.output.json.previousDir}}");
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
