/**
 * @file Tests for the `permission` tool's verdict on a shell line (RFC-028):
 *   the evidence lines of run 92029b1e are allowed with no rule, a read-only
 *   node refuses what its rules do not allow with a message, `unlisted: ask`
 *   and a yolo run bring the prompt back, a deny rule wins everywhere, and a
 *   line Ork cannot read, another tool, or a path a `Read(...)` rule denies
 *   still asks a person, offering the rules for the commands no rule covers.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type HumanChannel, SHIPPED_READS } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { orkTools } from "../src/index.ts";
import type { ToolContext } from "../src/tools/tool.ts";

type Rules = NonNullable<ToolContext["rules"]>;

const AnswerSchema = z.object({
  behavior: z.string(),
  message: z.string().optional(),
});

const READ_ONLY: Rules = {
  allow: ["Bash(git status)", "Bash(git status *)"],
  deny: ["Write", "Edit"],
  unlisted: "refuse",
};

const folder = (): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-permission-"));
  mkdirSync(path.join(cwd, "secrets"));
  writeFileSync(path.join(cwd, "secrets", "a"), "x");
  writeFileSync(path.join(cwd, "a.ts"), "one\n");
  return cwd;
};

/** What the tool answers about one call, and whether a person was asked. */
const ask = async (
  rules: Rules | undefined,
  input: Record<string, unknown>,
  options: { tool?: string; denyRead?: string[] } = {},
): Promise<{ behavior: string; message: string; asked: number }> => {
  let asked = 0;
  const human: HumanChannel = {
    ask: () => Promise.resolve(""),
    permit: () => {
      asked += 1;
      return Promise.resolve({ allow: true });
    },
  };
  const tool = orkTools({
    nodeId: "spec",
    driver: "claude-code",
    ports: { human },
    cwd: folder(),
    ...(rules === undefined ? {} : { rules }),
    ...(options.denyRead === undefined ? {} : { denyRead: options.denyRead }),
  }).find(each => each.name === "permission");
  const result = await tool?.call({ tool_name: options.tool ?? "Bash", input });
  const said = AnswerSchema.parse(JSON.parse(result?.content[0]?.text ?? "{}"));
  return { behavior: said.behavior, message: said.message ?? "", asked };
};

const bash = (rules: Rules | undefined, command: string) =>
  ask(rules, { command });

const EVIDENCE = [
  "ork logs 92029b1e --json | jq '.[] | select(.type == \"node.ended\") | .node'",
  "for r in 88c3f7b5 92029b1e; do ork logs $r --json | jq -r '.[].type' | sort | uniq -c; done",
  "( ork logs 92029b1e | head -40 ); ls ~/.ork/projects",
  "timeout 60 ork logs 92029b1e --json | jq length",
  'for r in a b; do echo "== $r"; ork tree $r 2>/dev/null | head -20; done',
  "ork ps --limit 5 && ork usage --since 7d",
  "ork feedback list --json | jq '.[0]'; ork follow-ups show f1",
];

describe("the permission tool's verdict", () => {
  it.each(EVIDENCE)(
    "allows the evidence line %s on a read-only node",
    async line => {
      expect(await bash(READ_ONLY, line)).toEqual({
        behavior: "allow",
        message: "",
        asked: 0,
      });
    },
  );

  it.each(EVIDENCE)(
    "allows the evidence line %s with no rule at all",
    async line => {
      expect(await bash({ allow: [], deny: [] }, line)).toMatchObject({
        behavior: "allow",
        asked: 0,
      });
    },
  );

  it("allows a line the node's allow rules and the shipped set cover together", async () => {
    const rules = { allow: ["Bash(pnpm test *)"], deny: [] };
    expect(await bash(rules, "pnpm test --run | tail -5")).toMatchObject({
      behavior: "allow",
      asked: 0,
    });
  });

  it("refuses a command outside a read-only node's rules, naming them and the shipped set", async () => {
    const said = await bash(READ_ONLY, "pnpm test");
    expect(said).toMatchObject({ behavior: "deny", asked: 0 });
    expect(said.message).toContain("`pnpm test` is not one of them");
    expect(said.message).toContain("`Bash(git status)`, `Bash(git status *)`");
    expect(said.message).toContain(SHIPPED_READS);
    expect(said.message).toContain("a `pnpm` script is not a shipped read");
  });

  it.each(["date -f /etc/hosts", "date --file=/etc/hosts"])(
    "refuses %s on a read-only node, since date prints the file's lines",
    async line => {
      expect(await bash(READ_ONLY, line)).toMatchObject({
        behavior: "deny",
        asked: 0,
      });
    },
  );

  it("refuses an Ork read through pnpm on a read-only node, since pnpm runs the project's script", async () => {
    expect(await bash(READ_ONLY, "pnpm -s ork logs r1")).toMatchObject({
      behavior: "deny",
      asked: 0,
    });
  });

  it("refuses a shell read on a read-only node with the extract call to make", async () => {
    const said = await bash(READ_ONLY, "cat a.ts");
    expect(said).toMatchObject({ behavior: "deny", asked: 0 });
    expect(said.message).toContain('"step":"read"');
  });

  it("refuses a writing node whose unlisted commands are refused", async () => {
    const rules: Rules = { allow: [], deny: [], unlisted: "refuse" };
    expect(await bash(rules, "rm -rf build")).toMatchObject({
      behavior: "deny",
      asked: 0,
    });
  });

  it("asks under unlisted: ask, and when unlisted is unset", async () => {
    expect(await bash({ ...READ_ONLY, unlisted: "ask" }, "pnpm test")).toEqual({
      behavior: "allow",
      message: "",
      asked: 1,
    });
    expect(await bash({ allow: [], deny: [] }, "pnpm test")).toMatchObject({
      asked: 1,
    });
  });

  it("never refuses in a yolo run, where deny rules still apply", async () => {
    const yolo: Rules = { ...READ_ONLY, yolo: true };
    expect(await bash(yolo, "pnpm test")).toMatchObject({
      behavior: "allow",
      asked: 1,
    });
    expect(
      await bash({ ...yolo, deny: ["Bash(git push *)"] }, "git push origin"),
    ).toEqual({
      behavior: "deny",
      message: "denied for this node",
      asked: 0,
    });
  });

  it("lets a deny rule win over the shipped set", async () => {
    const rules: Rules = { allow: [], deny: ["Bash(ork logs:*)"] };
    expect(await bash(rules, "ork logs r1 | jq .")).toMatchObject({
      behavior: "deny",
      message: "denied for this node",
    });
  });

  it.each(["Bash(ork decide *)", "Bash(timeout *)"])(
    "checks `timeout 60 ork decide x` as the wrapper line and as the command: %s denies it",
    async rule => {
      expect(
        await bash({ allow: [], deny: [rule] }, "timeout 60 ork decide x"),
      ).toMatchObject({ behavior: "deny", message: "denied for this node" });
    },
  );

  it("does not let a wrapper carry an unshipped command", async () => {
    expect(await bash(READ_ONLY, "timeout 60 ork decide x")).toMatchObject({
      behavior: "deny",
      asked: 0,
    });
    expect(
      await bash({ allow: [], deny: [] }, "timeout 60 ork decide x"),
    ).toMatchObject({
      asked: 1,
    });
  });

  it.each(["cat $(ls)", "echo x > out.txt", "eval ls"])(
    "asks about the line %s Ork cannot read, even on a read-only node",
    async line => {
      expect(await bash(READ_ONLY, line)).toMatchObject({ asked: 1 });
    },
  );

  it("asks about another tool, even on a read-only node", async () => {
    expect(
      await ask(
        READ_ONLY,
        { url: "https://example.com" },
        { tool: "WebFetch" },
      ),
    ).toMatchObject({ asked: 1 });
  });

  it("asks about a path a Read rule denies, even on a read-only node", async () => {
    const said = await ask(
      { ...READ_ONLY, deny: [...READ_ONLY.deny, "Read(secrets/**)"] },
      { command: "ork ps; wc -l secrets/a" },
      { denyRead: ["secrets/**"] },
    );
    expect(said).toMatchObject({ asked: 1 });
    expect(await bash(READ_ONLY, "wc -l .env")).toMatchObject({ asked: 1 });
  });

  it("does not cover a shipped read of a file outside the folder, but lists any folder", async () => {
    const rules: Rules = { ...READ_ONLY, reading: "open" };
    expect(await bash(rules, "wc -l /etc/hosts")).toMatchObject({
      behavior: "deny",
      asked: 0,
    });
    expect(await bash(rules, "cd / && wc -l etc/hosts")).toMatchObject({
      behavior: "deny",
    });
    expect(await bash(rules, "ls /etc")).toMatchObject({ behavior: "allow" });
    expect(await bash(rules, "wc -l ~/.ork/project.yaml")).toMatchObject({
      behavior: "allow",
    });
  });

  it("asks about every call as before when the session gave no rules", async () => {
    expect(await bash(undefined, "ork logs r1")).toMatchObject({ asked: 1 });
  });
});

/** The rules the tool offers a person with a prompt about `command`. */
const offered = async (
  rules: Rules | undefined,
  command: string,
): Promise<readonly string[] | undefined> => {
  const seen: (readonly string[] | undefined)[] = [];
  const human: HumanChannel = {
    ask: () => Promise.resolve(""),
    permit: request => {
      seen.push(request.rules);
      return Promise.resolve({ allow: true });
    },
  };
  await orkTools({
    nodeId: "spec",
    driver: "claude-code",
    ports: { human },
    cwd: folder(),
    ...(rules === undefined ? {} : { rules }),
  })
    .find(each => each.name === "permission")
    ?.call({ tool_name: "Bash", input: { command } });
  return seen[0];
};

describe("the rules a prompt offers", () => {
  it("names one rule per command no rule covers, and none for what is covered", async () => {
    expect(
      await offered(
        { allow: [], deny: [] },
        "git -C x log | head -3 && ork logs r1 --json && git diff HEAD",
      ),
    ).toEqual(["Bash(git log *)", "Bash(git diff *)"]);
  });

  it("offers none when a command has no rule, a line is unreadable, or the session gave no rules", async () => {
    const none = { allow: [], deny: [] };
    expect(await offered(none, "git log && python3 x.py")).toBeUndefined();
    expect(await offered(none, "cat $(ls)")).toBeUndefined();
    expect(await offered(undefined, "git log")).toBeUndefined();
  });
});
