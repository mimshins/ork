/**
 * @file Tests the profile counts and the files `ledger`, `consolidate` and
 *   `findings` write: the first 8 (`quick`) or 20 (`standard`) units are hunted
 *   and the rest `deferred`, candidates are deduped and capped at 12 or 30 with
 *   the rest `needs_validation`, each profile's node budgets add up under its
 *   cap, and the files pass the skill's own validator scripts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runConsolidate } from "../findings.ts";
import { buildLedger, type LedgerUnit, runLedger } from "../ledger.ts";
import { maxSpendUsd, PROFILES, type ProfileName } from "../profiles.ts";
import { runFindings } from "../verdicts.ts";
import {
  auditEnv,
  candidate,
  cleanUp,
  confirmed,
  gitRepo,
  reconUnits,
  skillPresent,
  validate,
} from "./kit.ts";

afterEach(cleanUp);

const readLedger = (file: string): LedgerUnit[] => {
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(data)
    ? data.filter(
        (unit: unknown): unit is LedgerUnit => typeof unit === "object",
      )
    : [];
};

const statuses = (ledger: { status: string }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const unit of ledger) {
    counts[unit.status] = (counts[unit.status] ?? 0) + 1;
  }
  return counts;
};

const consolidate = (profile: ProfileName, hunts: unknown[]) =>
  runConsolidate(gitRepo({ "a.txt": "x" }), auditEnv({ PROFILE: profile }), {
    hunts,
  });

const hunts = (count: number, repeat = 0): unknown[] => [
  {
    candidates: Array.from({ length: count }, (_, index) =>
      candidate(`fp-${index}`),
    ),
  },
  {
    candidates: Array.from({ length: repeat }, (_, index) =>
      candidate(`fp-${index}`),
    ),
  },
];

// The skill's validators live in `.ai/skills/security-audit/` (or
// `AUDIT_SKILL_DIR`); their tests wait until that folder is there.
const describeWithSkill = skillPresent() ? describe : describe.skip;

describe("the profile's counts", () => {
  it.each([
    ["quick", 8, 4],
    ["standard", 20, 5],
  ] as const)(
    "%s hunts the first %i units and defers the rest",
    (profile, hunted, extra) => {
      const { ledger, hunt, deferred } = buildLedger(
        reconUnits(hunted + extra),
        profile,
      );
      expect(hunt.map(item => item.surface)).toEqual(
        Array.from({ length: hunted }, (_, index) => `surface ${index}`),
      );
      expect(statuses(ledger)).toEqual({ planned: hunted, deferred: extra });
      expect(deferred).toBe(extra);
      expect(
        ledger
          .filter(unit => unit.status === "deferred")
          .every(unit => unit.unresolved.length > 0),
      ).toBe(true);
    },
  );

  it("drops a unit whose coverage ID an earlier one has", () => {
    const units = reconUnits(1);
    expect(buildLedger([...units, ...units], "quick").ledger).toHaveLength(1);
  });

  it.each(["quick", "standard"] as const)(
    "%s's node budgets add up under its cap",
    (profile: ProfileName) => {
      expect(maxSpendUsd(profile)).toBeLessThanOrEqual(
        PROFILES[profile].capUsd,
      );
    },
  );
});

describe("consolidate", () => {
  it("dedupes by fingerprint and passes on at most 12 under quick", () => {
    const result = consolidate("quick", hunts(15, 3));
    expect(result).toMatchObject({ total: 18, duplicates: 3, cap: 12 });
    expect(result.unique).toHaveLength(12);
    expect(result.unreviewed).toHaveLength(3);
  });

  it("passes on at most 30 under standard", () => {
    const result = consolidate("standard", hunts(35));
    expect(result.unique).toHaveLength(30);
    expect(result.unreviewed).toHaveLength(5);
  });

  it("says in each needs_validation record that it was not looked at", () => {
    const [record] = consolidate("quick", hunts(13)).unreviewed;
    expect(record).toMatchObject({
      verdict: "needs_validation",
      fingerprint: "fp-12",
    });
    expect(JSON.stringify(record)).toContain("Not looked at");
  });

  it("marks a gap the critic accepted as deferred in the ledger", () => {
    const repo = gitRepo({ "a.txt": "x" });
    const env = auditEnv({ PROFILE: "quick" });
    const { hunt, outputDir } = runLedger(repo, env, { units: reconUnits(2) });
    const id = String(hunt[0]?.coverage_id);
    const result = runConsolidate(repo, env, {
      hunts: [],
      gaps: [{ coverage_id: id, reason: "auth flow" }, { coverage_id: "nope" }],
    });
    expect(result.ignoredGaps).toEqual(["nope"]);
    const ledger = readLedger(path.join(outputDir, "coverage-ledger.json"));
    expect(ledger.find(unit => unit.coverage_id === id)).toMatchObject({
      status: "deferred",
      unresolved: ["Coverage gap the critic accepted: auth flow"],
    });
  });
});

describeWithSkill("the skill's validators accept what the tools write", () => {
  it.each(["quick", "standard"] as const)("%s's ledger", profile => {
    const repo = gitRepo({ "a.txt": "x" });
    const { outputDir } = runLedger(repo, auditEnv({ PROFILE: profile }), {
      units: reconUnits(25),
    });
    const result = validate(
      "validate-coverage-ledger.cjs",
      path.join(outputDir, "coverage-ledger.json"),
    );
    expect(result.output).toContain("PASS");
    expect(result.ok).toBe(true);
  });

  it("findings.json from verifier records and unreviewed candidates", () => {
    const repo = gitRepo({ "a.txt": "x" });
    const env = auditEnv({ PROFILE: "quick" });
    const { outputDir } = runConsolidate(repo, env, {
      hunts: [
        {
          candidates: Array.from({ length: 14 }, (_, index) =>
            candidate(`fp-${index}`),
          ),
        },
      ],
    });
    const result = runFindings(repo, env, {
      records: [confirmed("fp-3"), confirmed("fp-0")],
    });
    expect(result.counts).toEqual({ confirmed: 2, needs_validation: 2 });
    const checked = validate(
      "validate-findings.cjs",
      path.join(outputDir, "findings.json"),
    );
    expect(checked.output).toContain("PASS: 4 findings valid");
    expect(checked.ok).toBe(true);
  });
});
