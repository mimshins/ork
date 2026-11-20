/**
 * @file The Codex hook (`codex-hook.ts`): the generated script run on sample
 *   hook input, as Codex runs it, against a node's rules (allow, deny, `only`,
 *   yolo, shell lines command by command, patches, MCP calls, shell reads), a
 *   failure refusing the call, the private folder's modes, the calls count and
 *   the removal, and the TOML values Ork passes by `-c`.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type HookFile,
  shellQuote,
  tomlValue,
  writeHook,
} from "../src/adapters/codex-hook.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const specOf = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  nodeId: "cx",
  cwd: temp("ork-codex-cwd-"),
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
  reading: "open",
  ...over,
});

const DenySchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.literal("PreToolUse"),
    permissionDecision: z.literal("deny"),
    permissionDecisionReason: z.string(),
  }),
});

/** Runs the hook on `stdin`; the refusal's reason, or `undefined` if allowed. */
const runHook = (hook: HookFile, stdin: string): string | undefined => {
  const ran = spawnSync(process.execPath, [hook.file], {
    input: stdin,
    encoding: "utf8",
  });
  // An allow is a hook that ran to its end, not one that crashed.
  expect(ran.status).toBe(0);
  return ran.stdout === ""
    ? undefined
    : DenySchema.parse(JSON.parse(ran.stdout)).hookSpecificOutput
        .permissionDecisionReason;
};

/** The hook's answer to one call under `over`'s rules. */
const answer = (
  over: Partial<SessionSpec>,
  tool: string,
  input: Record<string, unknown>,
): string | undefined => {
  const hook = writeHook(specOf(over), temp("ork-codex-root-"));
  try {
    return runHook(
      hook,
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
        permission_mode: "bypassPermissions",
      }),
    );
  } finally {
    hook.remove();
  }
};

const bash = (
  over: Partial<SessionSpec>,
  command: string,
): string | undefined => answer(over, "Bash", { command });

const rules = (
  allow: string[],
  deny: string[] = [],
  only?: string[],
): Partial<SessionSpec> => ({
  tools: { allow, deny, ...(only === undefined ? {} : { only }) },
});

const PATCH = {
  command: "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch",
};

/** A shell call's hook input. */
const call = (command: string): string =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command } });

describe("the codex hook's rules", () => {
  it("allows what a rule allows and refuses the rest, in Claude Code's words", () => {
    expect(bash(rules(["Bash(git:*)"]), "git status")).toBeUndefined();
    expect(bash(rules(["Bash(git:*)"]), "rm -rf x")).toBe(
      "Ork: Bash is not allowed for this node. Do not retry it",
    );
  });

  it("checks a shell line command by command", () => {
    expect(
      bash(rules(["Bash(git:*)"]), "git status && git log"),
    ).toBeUndefined();
    expect(bash(rules(["Bash(git:*)"]), "git status && rm x")).toContain(
      "not allowed",
    );
    expect(bash(rules(["Bash(git:*)"]), "git log $(rm x)")).toContain(
      "not allowed",
    );
  });

  it("lets a deny win over an allow", () => {
    expect(bash(rules(["Bash"], ["Bash(rm:*)"]), "rm x")).toContain(
      "denied for this node",
    );
  });

  it("refuses what is not one of the node's `only` tools, also in yolo", () => {
    expect(
      bash({ ...rules([], [], ["Bash(git:*)"]), yolo: true }, "ls"),
    ).toContain("not one of this node's tools");
  });

  it("allows in yolo what deny and only don't refuse", () => {
    expect(bash({ ...rules([]), yolo: true }, "ls")).toBeUndefined();
    expect(
      bash({ ...rules([], ["Bash(rm:*)"]), yolo: true }, "rm x"),
    ).toContain("denied");
  });

  it("covers apply_patch with Edit and Write rules, and acceptEdits", () => {
    expect(answer(rules(["Edit"]), "apply_patch", PATCH)).toBeUndefined();
    expect(answer(rules(["Write"]), "apply_patch", PATCH)).toBeUndefined();
    expect(
      answer({ permissionMode: "acceptEdits" }, "apply_patch", PATCH),
    ).toBeUndefined();
    expect(answer(rules([]), "apply_patch", PATCH)).toBe(
      "Ork: apply_patch is not allowed for this node. Do not retry it",
    );
  });

  it("refuses apply_patch under an Edit or a Write deny", () => {
    expect(
      [["Edit"], ["Write"]].map(deny =>
        answer({ ...rules(["Bash"], deny), yolo: true }, "apply_patch", PATCH),
      ),
    ).toEqual([
      "Ork: apply_patch is denied for this node. Do not retry it",
      "Ork: apply_patch is denied for this node. Do not retry it",
    ]);
  });

  it("lets a rule with no Codex action allow nothing", () => {
    expect(answer(rules(["Read", "WebFetch"]), "apply_patch", PATCH)).toContain(
      "not allowed",
    );
    expect(bash(rules(["Read", "WebFetch"]), "git status")).toContain(
      "not allowed",
    );
  });

  it("always lets Ork's tools through, and holds other MCP servers to rules", () => {
    expect(
      answer(rules([]), "mcp__ork__report", { summary: "x" }),
    ).toBeUndefined();
    expect(answer(rules([]), "mcp__github__issue", {})).toContain(
      "not allowed",
    );
    expect(
      answer(rules(["mcp__github"]), "mcp__github__issue", {}),
    ).toBeUndefined();
  });

  it("refuses a tool name Ork does not know, also in yolo", () => {
    expect(answer({ yolo: true }, "web_search", {})).toBe(
      "Ork: web_search is not a tool Ork knows. Do not retry it",
    );
  });

  it("refuses a shell read with the extract call to make", () => {
    expect(
      bash({ ...rules(["Bash"]), reading: "extract" }, "cat a.txt"),
    ).toContain("Use the extract tool instead");
    expect(
      bash({ ...rules(["Bash"]), reading: "extract-only" }, "cat a.txt"),
    ).toContain("Use the extract tool instead");
    expect(
      bash({ ...rules(["Bash"]), reading: "extract" }, "pnpm test"),
    ).toBeUndefined();
  });
});

describe("the codex hook's file", () => {
  it("refuses a call when its input can't be read", () => {
    const hook = writeHook(specOf(), temp("ork-codex-root-"));
    expect(runHook(hook, "not json")).toContain("could not be checked");
    hook.remove();
  });

  it("refuses a call when its rules can't be loaded", () => {
    const hook = writeHook(specOf(rules(["Bash"])), temp("ork-codex-root-"));
    rmSync(path.join(path.dirname(hook.file), "rules.mjs"));
    expect(
      runHook(
        hook,
        JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
      ),
    ).toContain("could not be checked");
    hook.remove();
  });

  it("is private, outside the checkout, counts its calls and is removed", () => {
    const spec = specOf(rules(["Bash(git:*)"]));
    const hook = writeHook(spec, temp("ork-codex-root-"));
    const dir = path.dirname(hook.file);
    runHook(hook, call("git status"));
    runHook(hook, call("rm x"));
    expect(hook.count()).toEqual({ calls: 2, refused: 1 });
    expect(dir.startsWith(spec.cwd)).toBe(false);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(
      ["hook.mjs", "rules.mjs", "calls.jsonl"].map(
        name => statSync(path.join(dir, name)).mode & 0o777,
      ),
    ).toEqual([0o600, 0o600, 0o600]);
    hook.remove();
    expect(existsSync(dir)).toBe(false);
    expect(hook.count()).toEqual({ calls: 0, refused: 0 });
  });

  it("gives the hooks.PreToolUse value that runs it with this node", () => {
    const hook = writeHook(specOf(), temp("ork-codex-root-"));
    expect(hook.config).toBe(
      `[{matcher = ".*", hooks = [{type = "command", command = ${JSON.stringify(
        `'${process.execPath}' '${hook.file}'`,
      )}}]}]`,
    );
    hook.remove();
  });
});

describe("shellQuote", () => {
  it("keeps quotes, dollars, backticks and backslashes literal in a shell", () => {
    const word = String.raw`it's $HOME and ` + "`id` \\ here";
    expect(
      spawnSync("sh", ["-c", `printf %s ${shellQuote(word)}`], {
        encoding: "utf8",
      }).stdout,
    ).toBe(word);
    expect(shellQuote("a'b")).toBe(String.raw`'a'\''b'`);
  });
});

describe("tomlValue", () => {
  it("quotes strings with quotes, backslashes and newlines as basic strings", () => {
    expect(tomlValue('say "hi"\\ there\nnext')).toBe(
      String.raw`"say \"hi\"\\ there\nnext"`,
    );
  });

  it("writes arrays, inline tables, numbers and booleans", () => {
    expect(tomlValue({ url: "http://x", "a.b": [1, true], timeout: 600 })).toBe(
      '{url = "http://x", "a.b" = [1, true], timeout = 600}',
    );
  });
});
