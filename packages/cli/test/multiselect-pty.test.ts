/**
 * @file Tests the real `multiselect` on a pty (`script`), where it takes keys
 *   in raw mode: Space ticks, ↓ moves, Enter confirms; Esc and `q` leave the
 *   question for later; Ctrl-C ends it with the cursor shown and raw mode off.
 */

import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasPty, type PtyOrk, scriptOnPty } from "./pty.ts";

const FIXTURE = path.resolve(
  import.meta.dirname,
  "fixtures/multiselect-pty.ts",
);
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";
const KEYS = { space: " ", down: "\u001B[B", enter: "\r", esc: "\u001B" };
const CTRL_C = "\u0003";

let open: PtyOrk | undefined;

afterEach(() => {
  open?.child.kill("SIGKILL");
  open?.keys.destroy();
  open = undefined;
});

/**
 * Starts the fixture, waits for its prompt (it hides the cursor), types `keys`,
 * returns its result.
 */
const answered = async (
  ...keys: string[]
): Promise<{ result: Record<string, unknown>; screen: string }> => {
  const pty = scriptOnPty(FIXTURE, [], {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    TERM: "xterm-256color",
  });
  open = pty;
  await vi.waitFor(
    () => {
      expect(pty.output()).toContain(HIDE);
    },
    { timeout: 15_000 },
  );
  for (const key of keys) pty.keys.write(key);
  const matched = await vi.waitFor(
    () => {
      const found = /RESULT (\{.*\})/u.exec(pty.output());
      expect(found).not.toBeNull();
      return found?.[1] ?? "{}";
    },
    { timeout: 15_000 },
  );
  // Linux's `script` waits for its input to end before it exits.
  pty.keys.end();
  await pty.exited;
  const parsed: unknown = JSON.parse(matched);
  return {
    result: typeof parsed === "object" && parsed !== null ? { ...parsed } : {},
    screen: pty.output(),
  };
};

describe.skipIf(!hasPty)("multiselect on a terminal", () => {
  it("returns the ids ticked with Space, moving with the Down key", async () => {
    const { result } = await answered(
      KEYS.space,
      KEYS.down,
      KEYS.space,
      KEYS.enter,
    );
    expect(result).toMatchObject({
      kind: "chosen",
      ids: ["alpha", "beta"],
      raw: false,
    });
  });

  it("leaves the question for later on Esc", async () => {
    const { result } = await answered(KEYS.esc);
    expect(result).toMatchObject({ kind: "later" });
  });

  it("leaves the question for later on q", async () => {
    const { result } = await answered("q");
    expect(result).toMatchObject({ kind: "later" });
  });

  it("ends on Ctrl-C with the cursor shown and raw mode off", async () => {
    const { result, screen } = await answered(CTRL_C);
    expect(result).toMatchObject({ kind: "interrupted", raw: false });
    expect(screen.lastIndexOf(SHOW)).toBeGreaterThan(screen.lastIndexOf(HIDE));
  });
});
