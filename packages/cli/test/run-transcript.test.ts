/**
 * @file The `ork run` transcript on a fake terminal: node chips in a stable
 *   color, tool lines cut to the width with `+N lines`, paths relative to the
 *   node's worktree, agent text wrapped with a hanging indent, `--verbose`
 *   whole calls, the chips of the header and the summary, and the plain
 *   transcript (not a terminal, `NO_COLOR`, `ORK_PLAIN`) with no escape codes.
 */

import { stripVTControlCharacters } from "node:util";

import type { RunEvent, RunResult, RuntimeEvent } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatRunEvent } from "../src/index.ts";
import { createView, type View } from "../src/run/view.ts";
import { nodeChip } from "../src/term/chips.ts";
import { fakeTerm } from "./term-fake.ts";

const viewOf = (
  options: { tty?: boolean; columns?: number; env?: NodeJS.ProcessEnv } = {},
): View => createView(fakeTerm(options).io.output, options.env ?? {});

const inner = (id: string, event: RuntimeEvent): RunEvent => ({
  type: "node.event",
  id,
  event,
});

const tool = (id: string, input: Record<string, unknown>): RunEvent =>
  inner(id, { type: "tool.called", id: "t1", name: "Bash", input });

const lines = (view: View, events: RunEvent[], verbose = false): string[] => {
  const tools = new Map<string, string>();
  return events.flatMap(event =>
    formatRunEvent(event, 6, tools, false, verbose, view),
  );
};

const bare = (all: string[]): string[] =>
  all.map(line => stripVTControlCharacters(line));

const HEREDOC =
  "cat > notes.md <<'EOF'\nfirst\nsecond\nthird\nEOF\nrm -f /tmp/very-long-name-that-goes-on-and-on-and-on";

const summary = (status: RunResult["status"]): RunEvent => ({
  type: "run.finished",
  result: {
    runId: "r-1",
    status,
    costUsd: 0,
    nodes: [{ id: "w", runs: 1, ok: true, output: {}, costUsd: 0 }],
    worktrees: [],
    reasons: [],
  },
});

describe("the rich transcript", () => {
  it("gives a node's lines the node's chip, in the same color every time", () => {
    const view = viewOf({ columns: 60 });
    const [a, b] = lines(view, [
      tool("worker", { command: "ls" }),
      inner("worker", { type: "assistant.text", text: "hi" }),
    ]);
    const chip = nodeChip(view.term, "worker");
    expect(a?.startsWith(chip)).toBe(true);
    expect(b?.startsWith(chip)).toBe(true);
    expect(chip).toContain("\u001B[");
    expect(bare([chip])).toEqual([" worker "]);
  });

  it("shows a tool as `Tool  first line`, cut at the width with +N lines", () => {
    const [line = ""] = bare(
      lines(viewOf({ columns: 40 }), [tool("w", { command: HEREDOC })]),
    );
    expect(line).toBe(" w       Bash  cat > notes.md … +5 lines");
    expect(line.length).toBeLessThanOrEqual(40);
    const [long = ""] = bare(
      lines(viewOf({ columns: 30 }), [tool("w", { command: HEREDOC })]),
    );
    expect(long).toHaveLength(30);
    expect(long.endsWith("+5 lines")).toBe(true);
    expect(long).toContain("…");
  });

  it("says +1 line for one more line", () => {
    const [line = ""] = bare(
      lines(viewOf({ columns: 60 }), [tool("w", { command: "a\nb" })]),
    );
    expect(line.endsWith("Bash  a +1 line")).toBe(true);
  });

  it("shows paths inside the node's worktree relative to it", () => {
    const view = viewOf({ columns: 80 });
    const [, line = ""] = bare(
      lines(view, [
        {
          type: "worktree",
          id: "w",
          action: "created",
          path: "/tmp/wt/w",
        },
        tool("w", { command: "cat /tmp/wt/w/src/a.ts /etc/hosts" }),
      ]),
    );
    expect(line).toContain("Bash  cat src/a.ts /etc/hosts");
    expect(line).not.toContain("/tmp/wt/w");
  });

  it("wraps agent text under a hanging indent as wide as the chip", () => {
    const text =
      "one two three four five six seven eight nine ten eleven twelve";
    const out = bare(
      lines(viewOf({ columns: 30 }), [
        inner("w", { type: "assistant.text", text }),
      ]),
    );
    expect(out.length).toBeGreaterThan(2);
    for (const line of out) expect(line.length).toBeLessThanOrEqual(30);
    const lead = " ".repeat(" w       ".length);
    expect(out[0]?.startsWith(" w       ")).toBe(true);
    for (const line of out.slice(1)) expect(line.startsWith(lead)).toBe(true);
    expect(out.join(" ").replaceAll(/\s+/gu, " ").trim()).toBe(`w ${text}`);
  });

  it("strips escape codes from agent text and tool input", () => {
    const out = lines(viewOf(), [
      inner("w", { type: "assistant.text", text: "\u001B[2Jgone" }),
      tool("w", { command: "echo \u001B[31mred" }),
    ]).map(line => stripVTControlCharacters(line));
    expect(out).toEqual([" w       gone", " w       Bash  echo red"]);
  });

  it("keeps a fork's lines within the width, its prefix counted", () => {
    const text = inner("lead", {
      type: "assistant.text",
      text: "a long answer that has to wrap at the screen width",
      fork: true,
    });
    const call = inner("lead", {
      type: "tool.called",
      id: "t1",
      name: "Bash",
      input: { command: HEREDOC },
      fork: true,
    });
    // A tool line needs 16 columns past the tag and prefix, so it gets 40.
    const wrapped = bare(lines(viewOf({ columns: 30 }), [text]));
    const called = bare(lines(viewOf({ columns: 40 }), [call]));
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(line.length).toBeLessThanOrEqual(30);
      expect(line).toContain("fork · ");
    }
    for (const line of called) {
      expect(line.length).toBeLessThanOrEqual(40);
      expect(line).toContain("fork · ");
    }
  });

  it("escapes a tool name that carries an escape code", () => {
    const out = lines(viewOf({ columns: 60 }), [
      inner("w", {
        type: "tool.called",
        id: "t1",
        name: "Ba\u001B[2Jsh",
        input: { command: "ls" },
      }),
    ]).join("\n");
    expect(out).not.toContain("\u001B[2J");
    expect(bare([out])[0]).toContain("Bash  ls");
  });

  it("shows each call whole with --verbose", () => {
    const out = bare(
      lines(viewOf({ columns: 30 }), [tool("w", { command: HEREDOC })], true),
    );
    expect(out.map(line => line.trim())).toEqual([
      "w       Bash  cat > notes.md <<'EOF'",
      "first",
      "second",
      "third",
      "EOF",
      "rm -f /tmp/very-long-name-that-goes-on-and-on-and-on",
    ]);
  });

  it("opens a run with a RUN chip and a blank line", () => {
    const out = bare(
      lines(viewOf(), [
        {
          type: "run.started",
          runId: "r-1",
          workflow: "wf",
          entries: ["a"],
          nodes: [{ id: "a", type: "agent.worker" }],
        },
      ]),
    );
    expect(out).toEqual([" RUN  run r-1 of wf starts at a", ""]);
  });

  it("closes a run with an OK, FAIL or WAIT chip, after a blank line", () => {
    const view = viewOf();
    const first = (status: RunResult["status"]): string[] =>
      bare(lines(view, [summary(status)])).slice(0, 2);
    expect(first("succeeded")).toEqual([
      "",
      " OK  run r-1 succeeded · $0.00 · 1 ran, 0 skipped",
    ]);
    expect(first("failed")[1]).toContain(" FAIL  run r-1 failed");
    expect(first("budget_exhausted")[1]).toContain(
      " WAIT  run r-1 budget exhausted",
    );
  });
});

describe("the plain transcript", () => {
  const events: RunEvent[] = [
    {
      type: "run.started",
      runId: "r-1",
      workflow: "wf",
      entries: ["a"],
      nodes: [{ id: "a", type: "agent.worker" }],
    },
    tool("w", { command: "ls -la" }),
    inner("w", { type: "assistant.text", text: "done" }),
    summary("succeeded"),
  ];
  const expected = [
    "▸ run r-1 of wf (starts at a)",
    "w      │ · Bash command: ls -la",
    "w      │ done",
    "",
    "✓ run r-1 succeeded · $0.00 · 1 ran, 0 skipped",
  ];

  it.each([
    ["not a terminal", { tty: false }],
    ["NO_COLOR", { env: { NO_COLOR: "1" } }],
    ["ORK_PLAIN", { env: { ORK_PLAIN: "1" } }],
  ])("is line-based and has no escape codes: %s", (_, options) => {
    const out = lines(viewOf(options), events);
    expect(out).toEqual(expected);
    for (const line of out) expect(line).not.toContain("\u001B");
  });

  it("says a check run once was skipped, and the pass it stands on", () => {
    const skipped: RunEvent = {
      type: "verify.skipped",
      id: "w",
      check: "pnpm check",
      at: "2026-11-11T10:00:00.000Z",
      who: "r-0/docs",
    };
    expect(lines(viewOf({ tty: false }), [skipped])).toEqual([
      "w      │ ✓ pnpm check: already passed on these files · 2026-11-11T10:00:00.000Z · r-0/docs",
    ]);
  });

  it("shows a call whole with --verbose, still without escape codes", () => {
    const out = lines(
      viewOf({ tty: false }),
      [tool("w", { command: HEREDOC })],
      true,
    );
    expect(out[0]).toBe("w      │ · Bash cat > notes.md <<'EOF'");
    expect(out).toHaveLength(6);
    for (const line of out) expect(line).not.toContain("\u001B");
  });
});
