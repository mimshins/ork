/**
 * @file Tests for what a gate says when no terminal is there: in a foreground
 *   run, to start over with `--detach` and answer with `ork decide`; in a
 *   detached run, only where it is answered.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createTerminalHuman } from "../src/human.ts";

/** What a gate with no terminal prints, with `env` as the environment. */
const said = (env: NodeJS.ProcessEnv): string => {
  const output = new PassThrough();
  const lines: string[] = [];
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    lines.push(chunk);
  });
  const human = createTerminalHuman({
    input: new PassThrough(),
    output,
    interactive: false,
    env: { NO_COLOR: "1", ...env },
  });
  const withdraw = new AbortController();
  human
    .ask({
      nodeId: "ratify",
      question: "Ratify?",
      options: [{ id: "a" }],
      waits: true,
      signal: withdraw.signal,
    })
    .catch(() => null);
  withdraw.abort();
  return lines.join("");
};

describe("a gate with no terminal", () => {
  it("tells a foreground run to use --detach and ork decide", () => {
    expect(said({})).toContain(
      "ratify waits for ork decide or ork ui: use --detach and answer with ork decide",
    );
  });

  it("only says where a detached run's gate is answered", () => {
    const text = said({ ORK_DETACHED: "1" });
    expect(text).toContain("ratify waits for ork decide or ork ui");
    expect(text).not.toContain("--detach");
  });
});
