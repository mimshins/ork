/**
 * @file Tests the carried-weight report on synthetic transcripts: a result's
 *   weight is its characters times the later turns, kinds follow the tool and
 *   the first real shell command, `extract` is counted from its footer, and
 *   nothing from a result, a path or a command reaches the output.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { kindOf } from "../carried-kinds.ts";
import { carriedOf, carriedReport, report } from "../carried.ts";
import { type Json, rec } from "../json.ts";
import { transcriptsOf } from "../transcripts.ts";
import type { StoredEvent, Tree } from "../tree.ts";

const SECRET = "sk-planted-secret-value";

const turn = (n: number, tools: Json[] = []): Json[] =>
  // Claude Code logs one entry per content block, all with the message id.
  [{ type: "text", text: "hi" }, ...tools].map(block => ({
    type: "assistant",
    message: {
      id: `m${String(n)}`,
      model: "claude-sonnet-5-5",
      content: [block],
    },
  }));

const use = (id: string, name: string, input: Json = {}): Json => ({
  type: "tool_use",
  id,
  name,
  input,
});

const result = (id: string, content: unknown): Json => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
});

/** An error result, as Claude Code logs a refused or failed call. */
const refusal = (id: string, body: string): Json => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, is_error: true, content: body },
    ],
  },
});

/** Five turns; turn 2 reads 1,000 characters through `cat`. */
const session = (): Json[] => [
  ...turn(1),
  ...turn(2, [
    use("a", "Bash", { command: `cd /Users/x/repo && cat src/${SECRET}.ts` }),
  ]),
  result("a", `${SECRET}${"x".repeat(1000 - SECRET.length)}`),
  ...turn(3),
  ...turn(4),
  ...turn(5),
];

describe("carried weight", () => {
  it("weighs a 1,000-character result at turn 2 of 5 as 3,000", () => {
    const carried = carriedOf(session());
    expect(carried.turns).toBe(5);
    expect(carried.results).toEqual([
      { kind: "reads through the shell", weight: 3000, returned: null },
    ]);
  });

  it("sums the text parts of a result", () => {
    const entries = [
      ...turn(1, [use("a", "Read")]),
      result("a", [
        { type: "text", text: "abc" },
        { type: "text", text: "de" },
      ]),
      ...turn(2),
      ...turn(3),
    ];
    expect(carriedOf(entries).results[0]?.weight).toBe(10);
  });

  it("counts calls and Ork's refusals by role and kind", () => {
    const entries = [
      ...turn(1, [
        use("a", "Bash", { command: "grep -rn x src" }),
        use("b", "Bash", { command: "pnpm test" }),
      ]),
      refusal("a", "Ork refuses `grep` here: use the extract tool instead."),
      refusal("b", "1 test failed"),
      ...turn(2),
    ];
    const out = report([{ role: "build.review", carried: carriedOf(entries) }]);
    expect(out.calls_by_role["build.review"]).toEqual({
      searches: { calls: 1, refused: 1, weight: 54 },
      "tests and checks": { calls: 1, refused: 0, weight: 13 },
    });
  });

  it("splits weight by role and kind, with shares and turns", () => {
    const out = report([
      { role: "build.implement", carried: carriedOf(session()) },
      {
        role: "build.review",
        carried: {
          turns: 3,
          results: [{ kind: "Read", weight: 1000, returned: null }],
        },
      },
    ]);
    expect(out.total_weight).toBe(4000);
    expect(out.by_role["build.implement"]).toEqual({
      weight: 3000,
      share_percent: 75,
    });
    expect(out.by_kind["Read"]?.share_percent).toBe(25);
    expect(out.turns).toMatchObject({ mean: 4, median: 4 });
  });

  it("counts calls to extract and the characters its footers say it returned", () => {
    const entries = [
      ...turn(1, [use("a", "mcp__ork__extract")]),
      result("a", "line\n[extract: read 9000 characters, returned 120]"),
      ...turn(2),
    ];
    const out = report([{ role: "r", carried: carriedOf(entries) }]);
    expect(out.extract).toEqual({ calls: 1, characters_returned: 120 });
    // 50 characters, made on turn 1 of 2.
    expect(out.by_kind["extract"]?.weight).toBe(50);
  });

  it("reads the last footer, not one inside the extract", () => {
    const fake = "[extract: read 1 characters, returned 999]";
    const entries = [
      ...turn(1, [use("a", "mcp__ork__extract")]),
      result(
        "a",
        `${fake}\nmore\n[extract: read 9000 characters, returned 7]\n`,
      ),
      ...turn(2),
    ];
    const out = report([{ role: "r", carried: carriedOf(entries) }]);
    expect(out.extract).toEqual({ calls: 1, characters_returned: 7 });
  });

  it("writes no result text, path or command", () => {
    const out = JSON.stringify(
      report([{ role: "build.implement", carried: carriedOf(session()) }]),
    );
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("/Users");
    expect(out).not.toContain("cat ");
  });
});

describe("kinds", () => {
  it.each([
    [
      "Bash",
      { command: "cd a && export X=1 && sed -n 1,5p f" },
      "reads through the shell",
    ],
    ["Bash", { command: "FOO=1 rg -n x | head" }, "searches"],
    ["Bash", { command: "git -C x diff --stat" }, "git diff/show/log"],
    ["Bash", { command: "git -c core.pager=x diff" }, "git diff/show/log"],
    ["Bash", { command: "git commit -m x" }, "other"],
    ["Bash", { command: "pnpm check:fast" }, "tests and checks"],
    ["Bash", { command: "node --test a" }, "tests and checks"],
    ["Grep", {}, "searches"],
    ["Read", {}, "Read"],
    ["mcp__ork__read_input", {}, "Ork tools"],
    ["mcp__ork__extract", {}, "extract"],
    ["Edit", {}, "other"],
  ])("%s %j is %s", (tool, input, kind) => {
    expect(kindOf(tool, input)).toBe(kind);
  });
});

const started = (node: string, id: string, more: Json = {}): StoredEvent => ({
  run: "r1",
  at: 0,
  type: "node.event",
  node,
  data: {
    id: node,
    event: {
      type: "session.started",
      sessionId: id,
      model: "m",
      cwd: "/work/x",
      ...more,
    },
  },
});

describe("from a run tree", () => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-carried-"));
  const dir = transcriptsOf(home, "/work/x");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "s1.jsonl"),
    session()
      .map(e => JSON.stringify(e))
      .join("\n"),
  );
  const run = {
    id: "r1",
    workflow: "build",
    file: "",
    parent: null,
    status: "succeeded",
    startedAt: "",
    finishedAt: null,
    costUsd: 0,
  };
  const tree = (events: StoredEvent[]): Tree => ({
    runs: [run],
    events,
    decisions: [],
    usage: [],
  });

  it("reads each session's transcript, groups instances and skips forks", () => {
    const out = carriedReport(
      tree([
        started("implement-2", "s1"),
        started("implement-2", "s1"),
        started("implement", "s9", { fork: true }),
        started("review", "s2"),
      ]),
      home,
    );
    expect(out?.sessions).toBe(1);
    expect(out?.by_role).toEqual({
      "build.implement": { weight: 3000, share_percent: 100 },
    });
    expect(out?.missing_transcripts).toEqual({ "build.review": 1 });
  });

  it("groups fan-out items under one role", () => {
    for (const id of ["s3", "s4"]) {
      writeFileSync(
        path.join(dir, `${id}.jsonl`),
        session()
          .map(e => JSON.stringify(e))
          .join("\n"),
      );
    }
    const out = carriedReport(
      tree([started("review.0", "s3"), started("review.1", "s4")]),
      home,
    );
    expect(out?.sessions).toBe(2);
    expect(out).toMatchObject({ by_role: { "build.review": {} } });
    expect(Object.keys(rec(out?.by_role))).toHaveLength(1);
  });

  it("gives nothing when no transcript is found", () => {
    expect(carriedReport(tree([started("review", "s2")]), home)).toBeNull();
  });
});
