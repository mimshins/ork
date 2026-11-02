/**
 * @file Tests for the app's root: it shows the serving Ork's version, or why it
 *   cannot reach it, and has no accessibility violations.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app/app.tsx";
import { violations } from "./axe.ts";
import { stubWindow } from "./dom.ts";

beforeEach(() => {
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answering = (status: number, body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
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
});
