/**
 * @file Tests for what feeds the live region: a message is said on the next
 *   tick, after the region empties, and stays long enough to be heard; what
 *   comes meanwhile is said together after it, without loss; and the same words
 *   again are a change the screen reader hears.
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
  it("says the first message on the next tick, the region emptied first", () => {
    const { region, announce } = open();
    void region.setValue("Before.");
    announce("Run failed.");
    expect(region.getValue()).toBe("");
    vi.advanceTimersByTime(0);
    expect(region.getValue()).toBe("Run failed.");
  });

  it("says the same words again as a change", () => {
    const { region, announce } = open();
    const seen: string[] = [];
    announce("Nothing was changed.");
    vi.advanceTimersByTime(1000);
    seen.push(region.getValue());
    announce("Nothing was changed.");
    seen.push(region.getValue());
    vi.advanceTimersByTime(0);
    seen.push(region.getValue());
    expect(seen).toEqual(["Nothing was changed.", "", "Nothing was changed."]);
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
    vi.advanceTimersByTime(1001);
    expect(region.getValue()).toBe("last failed. Theme: Light.");
  });

  it("says at once again after a quiet moment", () => {
    const { region, announce } = open();
    announce("One.");
    vi.advanceTimersByTime(1000);
    announce("Two.");
    vi.advanceTimersByTime(0);
    expect(region.getValue()).toBe("Two.");
  });
});
