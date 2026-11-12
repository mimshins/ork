/**
 * @file Accessibility checks (axe) for the token and partial states on the
 *   Monitor and the Runs panel (RFC-015): the Spent stat with a partial sum and
 *   both caps, a run row, and a tree row of a node with no price.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import { OwnershipTree } from "../../src/panels/ownership-tree.tsx";
import { RunRow } from "../../src/panels/run-row.tsx";
import { RunStats } from "../../src/panels/run-stats.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { treeNode } from "./monitor-fixtures.ts";

const noop = vi.fn<() => void>();

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("accessibility of the token states on the Monitor and Runs", () => {
  it("has no violations in a Spent stat with a partial sum and both caps", async () => {
    const { container } = render(
      <TipProvider>
        <RunStats
          budgetTokens={50_000}
          budgetUsd={5}
          facts={new Map()}
          now={0}
          run={{
            ...runView("r1"),
            costUsd: 1.2,
            partial: true,
            tokens: 48_200,
          }}
        />
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations in a run row with a partial sum and tokens", async () => {
    const { container } = render(
      <TipProvider>
        <ul>
          <RunRow
            onSelect={noop}
            run={{
              ...runView("r1"),
              costUsd: 1.2,
              partial: true,
              tokens: 48_200,
            }}
            selected={false}
            tabStop={false}
            waiting={false}
          />
        </ul>
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("has no violations in a tree row of a node with no price", async () => {
    const facts = new Map([
      ["scan", { status: "succeeded" as const, tokens: 150, unpriced: true }],
    ]);
    const { container } = render(
      <TipProvider>
        <OwnershipTree
          connections={new Map()}
          edges={[]}
          facts={facts}
          hovered={null}
          now={0}
          onHover={noop}
          onNodeMenu={noop}
          onSelect={noop}
          roots={[treeNode("scan", { unpriced: true })]}
          runFinishedAt={undefined}
          selected={null}
        />
      </TipProvider>,
    );
    expect(await violations(container)).toEqual([]);
  });
});
