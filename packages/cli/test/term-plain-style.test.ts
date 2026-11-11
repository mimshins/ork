/**
 * @file Tests that `--plain` (`ORK_PLAIN`) reaches every styled mark: `style()`
 *   reads the environment on each call (the flag is set after the modules
 *   load), and the marks of `ork doctor` and `ork link`, once built at load,
 *   are built at use. Color is forced on with `FORCE_COLOR` so a plain result
 *   is the flag's doing, not the test runner's non-terminal stdout.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { formatCheck, formatLinks } from "../src/index.ts";
import { style } from "../src/output.ts";

const ESC = "\u001B";

const COLORED = { FORCE_COLOR: "1", ORK_PLAIN: "", NO_COLOR: "" };

const withEnv = (env: Record<string, string>): void => {
  for (const [name, value] of Object.entries({ ...COLORED, ...env })) {
    vi.stubEnv(name, value);
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const PLAIN_TERM = { rich: false, width: 80, rows: 24 };

const link = {
  tool: "claude",
  kind: "agents",
  path: ".claude/agents",
  origin: ".ork/agents",
  state: "missing",
} as const;

describe("style", () => {
  it("colors when color is forced and nothing asks for plain", () => {
    withEnv({});
    expect(style("green", "ok")).toContain(ESC);
  });

  it.each([{ ORK_PLAIN: "1" }, { ORK_PLAIN: "true" }, { NO_COLOR: "1" }])(
    "returns the text unchanged with %j",
    env => {
      withEnv(env);
      expect(style("green", "ok")).toBe("ok");
    },
  );
});

describe("marks built at use", () => {
  it.each(["ok", "warn", "fail", "skip"] as const)(
    "gives ork doctor's %s check no escape code with ORK_PLAIN",
    status => {
      withEnv({ ORK_PLAIN: "1" });
      const lines = formatCheck(
        { name: "gh", status, detail: "d", hint: "do x" },
        PLAIN_TERM,
      );
      expect(lines.join("\n")).not.toContain(ESC);
    },
  );

  it("still colors doctor's mark without it", () => {
    withEnv({});
    const [line = ""] = formatCheck(
      { name: "gh", status: "ok", detail: "d" },
      PLAIN_TERM,
    );
    expect(line).toContain(ESC);
  });

  it("gives ork link's labels no escape code with ORK_PLAIN, and some without", () => {
    withEnv({ ORK_PLAIN: "1" });
    expect(formatLinks([link], [])[0]).toBe(
      "missing .claude/agents → .ork/agents",
    );
    vi.unstubAllEnvs();
    withEnv({});
    expect(formatLinks([link], [])[0]).toContain(ESC);
  });
});
