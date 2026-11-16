/**
 * @file Tests for the cost preview's caps: both built-ins set dollar and token
 *   limits, the total is their sum, and the line says each part.
 */

import {
  budgetWarnings,
  builtinWorkflowText,
  driverRefusals,
} from "@krapht/ork-core";
import { AGENT_DRIVERS } from "@krapht/ork-integrations";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  capsOfOnboard,
  previewLine,
  PROPOSE,
  WRITE,
} from "../src/onboard/caps.ts";

const limitsOf = (name: string) => {
  const parsed = parseWorkflow(builtinWorkflowText(name) ?? "");
  return parsed.ok ? parsed.workflow.limits : undefined;
};

const priced = (id: string) =>
  AGENT_DRIVERS.find(d => d.id === id)?.capabilities.price;

describe("capsOfOnboard", () => {
  it("sums both built-ins' limits", () => {
    const caps = capsOfOnboard();
    const propose = limitsOf(PROPOSE);
    const write = limitsOf(WRITE);
    expect(caps.propose.usd).toBe(propose?.budgetUsd);
    expect(caps.write.tokens).toBe(write?.budgetTokens);
    expect(caps.usd).toBe(caps.propose.usd + caps.write.usd);
    expect(caps.tokens).toBe(caps.propose.tokens + caps.write.tokens);
    expect(caps.usd).toBeGreaterThan(0);
    expect(caps.tokens).toBeGreaterThan(0);
  });

  const caps = {
    propose: { usd: 3, tokens: 600000 },
    write: { usd: 6, tokens: 1200000 },
    usd: 9,
    tokens: 1800000,
  };

  it("words the preview with the total and each part", () => {
    expect(previewLine(caps, true)).toBe(
      "The most this can spend: $9 or 1,800,000 tokens (propose $3, 600,000 tokens; write $6, 1,200,000 tokens).",
    );
  });

  it("shows tokens only, no dollars, for a driver that reports none", () => {
    const line = previewLine(caps, false);
    expect(line).toBe(
      "The most this can spend: 1,800,000 tokens (this driver reports no dollars, so only the token caps hold; propose 600,000, write 1,200,000).",
    );
    expect(line).not.toContain("$");
  });

  it("reads which drivers report dollars from their descriptors", () => {
    expect(priced("claude-code")).toBe(true);
    expect(priced("open-code")).toBe(true);
    expect(priced("command-code")).toBe(false);
  });
});

/** The places a built-in names a `model` or `driver`, as `where: key`. */
const namedModelsOf = (name: string): string[] => {
  const parsed = parseWorkflow(builtinWorkflowText(name) ?? "");
  if (!parsed.ok) return ["does not parse"];
  const { defaults, nodes } = parsed.workflow;
  const places: { where: string; holder: object | undefined }[] = [
    { where: "defaults", holder: defaults },
    ...Object.entries(nodes).map(([id, node]) => ({
      where: `node ${id}`,
      holder: node,
    })),
  ];
  return places.flatMap(({ where, holder }) =>
    ["model", "driver"]
      .filter(key => holder !== undefined && key in holder)
      .map(key => `${where}: ${key}`),
  );
};

describe("the built-ins name no model or driver", () => {
  it.each([PROPOSE, WRITE])("%s", name => {
    expect(namedModelsOf(name)).toEqual([]);
  });
});

/** What `ork validate --driver <driver>` finds on a built-in's session nodes. */
const driverFindings = (name: string, driver: "open-code" | "command-code") => {
  const parsed = parseWorkflow(builtinWorkflowText(name) ?? "");
  if (!parsed.ok) throw new Error(`${name} does not parse`);
  const choice = { override: driver };
  return {
    refused: driverRefusals(parsed.workflow, AGENT_DRIVERS, choice),
    warned: budgetWarnings(parsed.workflow, AGENT_DRIVERS, choice),
  };
};

describe("the built-ins on drivers other than claude-code", () => {
  it.each([PROPOSE, WRITE])(
    "%s runs on command-code with a no-dollars warning, never a refusal",
    name => {
      const { refused, warned } = driverFindings(name, "command-code");
      expect(refused).toEqual([]);
      expect(warned.length).toBeGreaterThan(0);
      expect(warned.every(w => w.message.includes("reports no dollars"))).toBe(
        true,
      );
    },
  );

  it.each([PROPOSE, WRITE])(
    "%s runs on open-code with no warning, as it reports dollars",
    name => {
      const { refused, warned } = driverFindings(name, "open-code");
      expect(refused).toEqual([]);
      expect(warned).toEqual([]);
    },
  );
});
