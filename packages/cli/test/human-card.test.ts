/**
 * @file Tests for the terminal `HumanChannel` on a fake terminal: the `ork
 *   decide` card (chips, wrapped question, dimmed context, the recommended
 *   option preselected), the one-line collapse, `q` leaving a question for
 *   later, a note, the permission yes-or-no, the same prompts plain, and the
 *   `--list` rows.
 */

import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import type { DecisionRecord } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { formatDecisions } from "../src/commands/decide-list.ts";
import { createTerminalHuman } from "../src/human.ts";
import { fakeTerm, type FakeTerm, KEY } from "./term-fake.ts";

const ask = {
  nodeId: "gate",
  question: "Merge the change into main now?",
  options: [{ id: "yes", label: "Merge" }, { id: "no" }],
  recommended: "no",
  context: "line one\nline two",
};

const humanOn = (term: FakeTerm) =>
  createTerminalHuman({
    input: term.io.input,
    output: term.io.output,
    interactive: true,
    env: {},
  });

const RULE = "Bash(pnpm -s ork logs *)";

/** A permission's choices with scopes, as the decision queue offers them. */
const SCOPED = [
  { id: "allow", label: "Allow", description: "this call only" },
  {
    id: "allow-node",
    label: "Allow for this node",
    description: `for this node: ${RULE}`,
  },
  { id: "allow-run", label: "Allow for this run", description: `run: ${RULE}` },
  {
    id: "allow-always",
    label: "Always allow",
    description: `always: ${RULE} in .ork/project.yaml`,
  },
  { id: "deny", label: "Deny" },
];

/** The scoped permission's answer after `keys`, notes going to `notes`. */
const scopedAnswer = async (keys: string[], notes: string[] = []) => {
  const term = fakeTerm({ columns: 80, rows: 30 });
  const permit = humanOn(term).permit({
    nodeId: "worker",
    toolName: "Bash",
    input: { command: "pnpm -s ork logs r1" },
    options: SCOPED,
    onNote: n => {
      notes.push(n);
    },
  });
  await term.press(...keys);
  return permit;
};

describe("the terminal channel's card", () => {
  it("draws the card, starts on the recommended option, and collapses to a line", async () => {
    const term = fakeTerm({ columns: 60 });
    const asked = humanOn(term).ask(ask);
    await term.press();
    expect(term.screen()).toEqual([
      "",
      "▌ ASK   gate",
      "▌Merge the change into main now?",
      "▌  line one",
      "▌  line two",
      "▌  1. Merge (yes)",
      "▌❯ 2. no (recommended)",
      "▌↑/↓ move · Enter choose",
    ]);
    await term.press(KEY.up, KEY.enter);
    expect(await asked).toBe("yes");
    expect(term.screen()).toEqual([" ✓ gate · yes"]);
  });

  it("names the run and place in `ork decide`, and collapses to the decision", async () => {
    const term = fakeTerm({ columns: 60 });
    const asked = humanOn(term).askAt(ask, {
      run: "509da722",
      decision: "509da722-1",
      index: 1,
      total: 3,
    });
    await term.press();
    expect(term.screen()[1]).toBe("▌ ASK   gate   run 509da722 · 1 of 3");
    await term.press(KEY.enter);
    expect(await asked).toBe("no");
    expect(term.screen()).toEqual([" ✓ 509da722-1 · no"]);
  });

  it("names the run's workflow after its id", async () => {
    const term = fakeTerm({ columns: 60 });
    const asked = humanOn(term).askAt(ask, {
      run: "509da722",
      workflow: "build",
      decision: "509da722-1",
    });
    await term.press();
    expect(term.screen()[1]).toBe("▌ ASK   gate   run 509da722 · build");
    await term.press(KEY.enter);
    expect(await asked).toBe("no");
  });

  it("leaves a question for later with q", async () => {
    const term = fakeTerm();
    const asked = humanOn(term).askAt(ask, {
      run: "r",
      decision: "r-1",
      index: 1,
      total: 1,
    });
    await term.press("q");
    expect(await asked).toBeNull();
  });

  it("wraps a long question on a narrow screen and names the keys that apply", async () => {
    const term = fakeTerm({ columns: 44 });
    const asked = humanOn(term).askAt(
      {
        ...ask,
        question:
          "Should the change that rewrites the whole exporter be merged into main now?",
        onNote: () => {
          /* the note taker only has to exist: it makes `n` a key */
        },
      },
      { run: "r", decision: "r-1", index: 1, total: 1 },
    );
    await term.press();
    expect(term.screen().slice(2, 5)).toEqual([
      "▌Should the change that rewrites the whole",
      "▌exporter be merged into main now?",
      "▌  line one",
    ]);
    expect(term.screen().at(-1)).toBe(
      "▌↑/↓ move · Enter choose · n note · q later",
    );
    await term.press(KEY.enter);
    await asked;
  });

  it("cuts a long context to six lines, shows the rest and the document with d, and all with verbose", async () => {
    const context = Array.from(
      { length: 10 },
      (_, i) => `context ${String(i + 1)}`,
    ).join("\n");
    const long = { ...ask, context, document: "the whole document" };
    const term = fakeTerm({ columns: 60, rows: 40 });
    const asked = humanOn(term).ask(long);
    await term.press();
    expect(term.screen().filter(line => line.startsWith("▌  context"))).toEqual(
      Array.from({ length: 6 }, (_, i) => `▌  context ${String(i + 1)}`),
    );
    expect(term.screen()).toContain("▌  … 4 more lines (d)");
    expect(term.screen().join("\n")).not.toContain("the whole document");
    await term.press("d");
    expect(term.screen().join("\n")).toContain("context 10");
    expect(term.screen().join("\n")).toContain("the whole document");
    await term.press(KEY.enter);
    await asked;
    const wide = fakeTerm({ columns: 60, rows: 40 });
    const all = createTerminalHuman({
      input: wide.io.input,
      output: wide.io.output,
      interactive: true,
      verbose: true,
      env: {},
    }).ask(long);
    await wide.press();
    expect(wide.screen().join("\n")).not.toContain("more lines");
    expect(wide.screen().join("\n")).toContain("context 10");
    await wide.press(KEY.enter);
    await all;
  });

  it("gives a note with n, to the asker's note taker", async () => {
    const term = fakeTerm();
    const notes: string[] = [];
    const asked = humanOn(term).ask({
      ...ask,
      onNote: n => {
        notes.push(n);
      },
    });
    await term.press("n", "h", "i", KEY.enter, KEY.enter);
    expect(await asked).toBe("no");
    expect(notes).toEqual(["hi"]);
  });

  it("asks a permission with a yes or no, and a note after a no", async () => {
    const term = fakeTerm({ columns: 60 });
    const notes: string[] = [];
    const permit = humanOn(term).permit({
      nodeId: "worker",
      toolName: "Bash",
      input: { command: "rm -rf dist" },
      onNote: n => {
        notes.push(n);
      },
    });
    await term.press();
    expect(term.screen().slice(0, 2)).toEqual([
      "",
      "▌ ASK   worker  wants to run Bash command: rm -rf dist",
    ]);
    await term.press("n", "w", "h", "y", KEY.enter);
    expect(await permit).toEqual({
      allow: false,
      message: "The user did not allow this tool.",
    });
    expect(notes).toEqual(["why"]);
  });

  it("stops on Ctrl-C at a permission: no note is asked for, and no answer comes", async () => {
    const term = fakeTerm({ columns: 60 });
    const notes: string[] = [];
    let stops = 0;
    const abort = new AbortController();
    const permit = createTerminalHuman({
      input: term.io.input,
      output: term.io.output,
      interactive: true,
      env: {},
      interrupt: () => {
        stops += 1;
      },
    }).permit({
      nodeId: "worker",
      toolName: "Bash",
      input: { command: "ls" },
      signal: abort.signal,
      onNote: n => {
        notes.push(n);
      },
    });
    await term.press(KEY.ctrlC);
    expect(stops).toBe(1);
    expect(term.screen().join("\n")).not.toContain("Note for the run");
    abort.abort(new Error("stopped"));
    await expect(permit).rejects.toThrow("stopped");
    expect(notes).toEqual([]);
  });

  it("lists the scopes of a permission with their rules, and answers the chosen one's", async () => {
    const term = fakeTerm({ columns: 80, rows: 30 });
    const permit = humanOn(term).permit({
      nodeId: "worker",
      toolName: "Bash",
      input: { command: "pnpm -s ork logs r1" },
      rules: [RULE],
      options: SCOPED,
    });
    await term.press();
    const screen = term.screen().join("\n");
    expect(screen).toContain("1. Allow (allow)");
    expect(screen).toContain("4. Always allow (allow-always)");
    expect(screen).toContain(`for this node: ${RULE}`);
    expect(screen).toContain(`always: ${RULE} in .ork/project.yaml`);
    await term.press("2", KEY.enter);
    expect(await permit).toEqual({ allow: true, scope: "node" });
    expect(term.screen().at(-1)).toBe(" ✓ worker · allow-node");
  });

  it("answers once with allow, and always with allow-always", async () => {
    expect(await scopedAnswer([KEY.enter])).toEqual({ allow: true });
    expect(await scopedAnswer(["4", KEY.enter])).toEqual({
      allow: true,
      scope: "always",
    });
  });

  it("takes a note after a denial from the list, and stops on Ctrl-C", async () => {
    const notes: string[] = [];
    expect(
      await scopedAnswer(["5", KEY.enter, "w", "h", "y", KEY.enter], notes),
    ).toEqual({ allow: false, message: "The user did not allow this tool." });
    expect(notes).toEqual(["why"]);
    const term = fakeTerm({ columns: 80, rows: 30 });
    let stops = 0;
    const abort = new AbortController();
    const permit = createTerminalHuman({
      input: term.io.input,
      output: term.io.output,
      interactive: true,
      env: {},
      interrupt: () => {
        stops += 1;
      },
    }).permit({
      nodeId: "worker",
      toolName: "Bash",
      input: { command: "ls" },
      options: SCOPED,
      signal: abort.signal,
    });
    await term.press(KEY.ctrlC);
    expect(stops).toBe(1);
    abort.abort(new Error("stopped"));
    await expect(permit).rejects.toThrow("stopped");
  });

  it("numbers a permission's scopes when plain", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let said = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      said += chunk;
    });
    const permit = createTerminalHuman({
      input,
      output,
      interactive: true,
      env: {},
    }).permit({
      nodeId: "worker",
      toolName: "Bash",
      input: { command: "pnpm -s ork logs r1" },
      options: SCOPED,
    });
    await expect.poll(() => said).toContain("Choose: ");
    input.write("allow-run\n");
    expect(await permit).toEqual({ allow: true, scope: "run" });
    expect(said).toContain("? worker wants to run Bash command:");
    expect(said).toContain(`3) Allow for this run (allow-run) - run: ${RULE}`);
  });

  it("keeps the numbered prompts when plain", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let said = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      said += chunk;
    });
    const asked = createTerminalHuman({
      input,
      output,
      interactive: true,
      env: {},
    }).ask(ask);
    await expect.poll(() => said).toContain("Choose [2]: ");
    input.write("1\n");
    expect(await asked).toBe("yes");
    expect(said).toContain("? gate asks: Merge the change into main now?");
    expect(said).toContain("  2) no (recommended)");
    expect(said).not.toContain("\u001B");
  });
});

describe("ork decide --list", () => {
  const decision: DecisionRecord = {
    id: "r-1",
    kind: "question",
    openedAt: "2026-11-11T00:00:00Z",
    status: "open",
    runId: "r",
    node: "gate",
    question: "Ship it?",
    options: [{ id: "ship" }, { id: "hold" }],
    recommended: "hold",
  };

  it("shows chips and columns on a terminal", () => {
    const rich = { rich: true, width: 60, rows: 24 };
    const lines = formatDecisions([decision], undefined, rich);
    expect(lines.join("")).toContain("\u001B[");
    expect(lines.map(line => stripVTControlCharacters(line))).toEqual([
      " ASK   gate  r-1  Ship it? [ship, hold*]",
    ]);
  });

  it("is a plain line without one", () => {
    expect(
      formatDecisions([decision], undefined, {
        rich: false,
        width: 80,
        rows: 24,
      }),
    ).toEqual(["r-1  gate  Ship it? [ship, hold*]"]);
  });
});
