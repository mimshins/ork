/**
 * @file Tests for the builder's list of problems: what walking the workflow
 *   came to, beside the list or in place of it, and how a problem names its
 *   node.
 */

import type { Diagnostic } from "@krapht/ork-server/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Problems } from "../../src/builder/canvas-parts.tsx";

const SUMMARY = "Walked 14 ways through: 8 succeed, 6 fail.";

const warning = (message: string, node: string): Diagnostic => ({
  severity: "warning",
  code: "walk.never-runs",
  message,
  path: ["nodes", node],
});

const show = (problems: readonly Diagnostic[], walk: string | null) => {
  const onChoose = vi.fn<(node: string) => void>();
  render(
    <Problems
      onChoose={onChoose}
      problems={problems}
      walk={walk}
    />,
  );
  return onChoose;
};

describe("the builder's problems", () => {
  afterEach(() => {
    cleanup();
  });

  it("says what walking it came to when there's nothing to fix", () => {
    show([], SUMMARY);
    expect(screen.getByText(`No problems found. ${SUMMARY}`)).toBeDefined();
  });

  it("says only that there are no problems if it wasn't walked", () => {
    show([], null);
    expect(screen.getByText("No problems found.")).toBeDefined();
  });

  it("says what walking it came to beside its warnings", () => {
    show([warning("`b` never runs", "b")], SUMMARY);
    expect(screen.getByText("Warnings")).toBeDefined();
    expect(screen.getByText(SUMMARY)).toBeDefined();
  });

  it("doesn't name a node twice", () => {
    show([warning("`b` never runs", "b")], SUMMARY);
    expect(screen.getByRole("button").textContent).toBe("b never runs");
  });

  it("names the node a message doesn't start with", () => {
    show([warning("reads `a`, which runs later", "b")], SUMMARY);
    expect(screen.getByRole("button").textContent).toBe(
      "b: reads a, which runs later",
    );
  });

  it("takes a person to the node", () => {
    const onChoose = show([warning("`b` never runs", "b")], SUMMARY);
    screen.getByRole("button").click();
    expect(onChoose).toHaveBeenCalledWith("b");
  });
});
