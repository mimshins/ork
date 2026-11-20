/**
 * @file The write limit (`SessionSpec.writeOnly`): the shared rule, Claude
 *   Code's hook (alone, and on the stand-in `claude`), and OpenCode, which
 *   refuses the session. The matcher the other drivers carry is in
 *   `write-limit-drivers.test.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHolds } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  OPEN_CODE_NO_WRITE_LIMIT,
  openCodeAdapter,
} from "../src/adapters/open-code.ts";
import { createCliRuntime, heavyHook, toolHook } from "../src/index.ts";
import { writeOnlyReason } from "../src/tools/write-limit.ts";
import {
  checkout,
  LIMIT,
  LIMITED,
  limitedSpec,
  tmp,
} from "./fixtures/write-limit.ts";

const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);

const signal = new AbortController().signal;

/** Reads a session's events to its end. */
const drain = async (events: AsyncIterable<unknown>): Promise<void> => {
  for await (const _ of events) {
    // Only the end matters.
  }
};

const ignore = (): void => {
  // Not under test.
};

describe("the write limit's rule", () => {
  it("lets an edit under a folder run, and refuses the rest and the two names", () => {
    expect(
      writeOnlyReason([".ork/a.md", ".ork/x/b.md"], LIMIT),
    ).toBeUndefined();
    expect(writeOnlyReason([".ork"], [".ork"])).toBeUndefined();
    expect(writeOnlyReason(["a/b.md"], ["."])).toBeUndefined();
    expect(
      [
        ["src/a.ts"],
        [".orkish/a.md"],
        ["../a.md"],
        [".ork/CLAUDE.md"],
        [".ork/x/agents.md"],
        [".ork/a.md", "README.md"],
        [],
        null,
      ].map(files => writeOnlyReason(files, LIMIT)?.includes(LIMITED)),
    ).toEqual(Array.from({ length: 8 }, () => true));
    expect(writeOnlyReason(["src/a.ts"], LIMIT)).toBe(
      "refused for this file (this session writes only under `.ork/`, and never to a file named CLAUDE.md or AGENTS.md)",
    );
  });
});

/** The Claude Code hook's answer to one call in `cwd`, under the limit. */
const claudeAnswer = async (
  cwd: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<string> => {
  const handler = toolHook({
    hold: createHolds({ onEvent: ignore, onChange: ignore }).forNode("worker"),
    heavy: heavyHook(),
    answer: answer => ({ answer }),
    windowMs: 1000,
    ended: signal,
    onDefer: ignore,
    refuse: reason => ({ refused: reason }),
    openReads: true,
    writeOnly: { cwd, folders: LIMIT },
  });
  return JSON.stringify(
    await handler(signal, {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: input,
    }),
  );
};

describe("the write limit in Claude Code's hook", () => {
  it("lets an edit under .ork/ go, and refuses one outside, through a link, or of CLAUDE.md", async () => {
    const cwd = checkout();
    const said = await Promise.all([
      claudeAnswer(cwd, "Write", { file_path: ".ork/a.md" }),
      claudeAnswer(cwd, "Edit", { file_path: path.join(cwd, ".ork/b.md") }),
      claudeAnswer(cwd, "Write", { file_path: "src/a.ts" }),
      claudeAnswer(cwd, "Edit", { file_path: ".ork/out/a.ts" }),
      claudeAnswer(cwd, "Write", { file_path: ".ork/CLAUDE.md" }),
      claudeAnswer(cwd, "NotebookEdit", { notebook_path: "n.ipynb" }),
      claudeAnswer(cwd, "Write", { file_path: "~/a.md" }),
      claudeAnswer(cwd, "Bash", { command: "cat src/a.ts" }),
    ]);
    expect(said.map(each => each.includes(LIMITED))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    // Reads are left alone under reading: open.
    expect(said[7]).toBe('{"answer":"go"}');
  });

  it("denies a stand-in claude's Write outside .ork/, telling it where to write", async () => {
    const answer = path.join(tmp("hook"), "answer.json");
    const session = createCliRuntime({
      bin: FAKE_CLAUDE,
      env: {
        ...process.env,
        FAKE_CLAUDE_WRITE: "AGENTS.md",
        FAKE_CLAUDE_HOOK_FILE: answer,
      },
    }).start(limitedSpec(checkout()), {
      human: {
        permit: () => Promise.resolve({ allow: true as const }),
        ask: () => Promise.resolve("a"),
      },
    });
    await drain(session.events);
    const said = readFileSync(answer, "utf8");
    expect(said).toContain('"permissionDecision":"deny"');
    expect(said).toContain(
      "Ork: Write is refused for this file (this session writes only under `.ork/`",
    );
  });
});

describe("the write limit on OpenCode", () => {
  it("refuses the session: its rules can't follow links", async () => {
    await expect(
      Promise.resolve().then(() =>
        openCodeAdapter.mcp.wire(
          limitedSpec(checkout()),
          { url: "http://127.0.0.1:1/mcp", token: "t" },
          { waiting: ignore, signal, env: {} },
        ),
      ),
    ).rejects.toThrow(OPEN_CODE_NO_WRITE_LIMIT);
  });
});
