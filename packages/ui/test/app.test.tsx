/**
 * @file Tests for the app's root: it follows the overview stream, shows the
 *   serving Ork's version or why it cannot reach it, and has no accessibility
 *   violations.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app/app.tsx";
import { violations } from "./axe.ts";
import { stubWindow } from "./dom.ts";
import { type FakeSources, stubEventSource } from "./fake-source.ts";
import { runView } from "./state/fixtures.ts";

let sources: FakeSources;

beforeEach(() => {
  stubWindow();
  sources = stubEventSource();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What the server's health route says; other reads find nothing. */
const answering = (status: number, health: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url === "/api/health" ? health : []), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
};

describe("the app", () => {
  it("shows the version of the Ork that serves it", async () => {
    answering(200, { version: "0.3.0", pid: 1, startedAt: "now" });
    const { container } = render(<App />);
    act(() => {
      sources.last().connected();
    });
    expect(await screen.findByText("Ork 0.3.0")).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });

  it("says why it cannot reach the server", async () => {
    answering(401, { error: "Sign in with the link ork ui printed." });
    render(<App />);
    expect(
      await screen.findByText(
        "Cannot reach ork ui: Sign in with the link ork ui printed.",
      ),
    ).toBeDefined();
  });

  it("shows what is live, and closes the stream when it unmounts", async () => {
    answering(200, { version: "0.3.0", pid: 1, startedAt: "now" });
    const { unmount } = render(<App />);
    const source = sources.last();
    act(() => {
      source.connected();
      source.send("runs", [runView("a")]);
      source.send("decisions", []);
    });
    expect(
      await screen.findByText("1 run live, 0 decisions open"),
    ).toBeDefined();
    unmount();
    expect(source.closed).toBe(true);
  });
});
