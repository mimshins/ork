/**
 * @file Tests for what feeds the live region: a message is said at once and
 *   stays long enough to be heard, and what comes meanwhile is said together
 *   after it, without loss.
 */

import { Container } from "react-containerized-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnnouncer } from "../../src/workspace/announcer.ts";

const open = () => {
  const region = Container.create("");
  return { region, announce: createAnnouncer(region) };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the announcer", () => {
  it("says the first message at once", () => {
    const { region, announce } = open();
    announce("Run failed.");
    expect(region.getValue()).toBe("Run failed.");
  });

  it("does not replace a message before it can be heard", () => {
    const { region, announce } = open();
    announce("Run failed.");
    vi.advanceTimersByTime(259);
    announce("last failed.");
    expect(region.getValue()).toBe("Run failed.");
  });

  it("says together what came while one was being heard", () => {
    const { region, announce } = open();
    announce("Run failed.");
    announce("last failed.");
    announce("Theme: Light.");
    vi.advanceTimersByTime(1000);
    expect(region.getValue()).toBe("last failed. Theme: Light.");
  });

  it("says at once again after a quiet moment", () => {
    const { region, announce } = open();
    announce("One.");
    vi.advanceTimersByTime(1000);
    announce("Two.");
    expect(region.getValue()).toBe("Two.");
  });
});
