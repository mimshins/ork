/**
 * @file Tests that the live `permission` tool gets its rules from the session
 *   spec (RFC-028): `tools.unlisted: refuse` refuses what no rule covers, `ask`
 *   or no setting asks, and a yolo spec is never refused.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { HumanChannel, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { orkTools } from "../src/index.ts";
import { sessionRules } from "../src/session-rules.ts";

const AnswerSchema = z.object({ behavior: z.string() });

const specOf = (over: Partial<SessionSpec>): SessionSpec => ({
  nodeId: "spec",
  cwd: mkdtempSync(path.join(tmpdir(), "ork-session-rules-")),
  prompt: "go",
  systemAppend: "",
  settingSources: [],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: {},
  ...over,
});

/** The tool's answer to `pnpm test` under the rules the runner builds. */
const answerFor = async (
  spec: SessionSpec,
): Promise<{ behavior: string; asked: number }> => {
  let asked = 0;
  const human: HumanChannel = {
    ask: () => Promise.resolve(""),
    permit: () => {
      asked += 1;
      return Promise.resolve({ allow: true });
    },
  };
  const result = await orkTools({
    nodeId: spec.nodeId,
    driver: "claude-code",
    ports: { human },
    cwd: spec.cwd,
    ...sessionRules(spec),
  })
    .find(each => each.name === "permission")
    ?.call({ tool_name: "Bash", input: { command: "pnpm test" } });
  const said = AnswerSchema.parse(JSON.parse(result?.content[0]?.text ?? "{}"));
  return { behavior: said.behavior, asked };
};

describe("the rules a session gives its permission tool", () => {
  it("refuses an unlisted command under tools.unlisted: refuse", async () => {
    expect(
      await answerFor(
        specOf({ tools: { allow: [], deny: [], unlisted: "refuse" } }),
      ),
    ).toEqual({ behavior: "deny", asked: 0 });
  });

  it("does not refuse in a yolo session", async () => {
    expect(
      await answerFor(
        specOf({
          tools: { allow: [], deny: [], unlisted: "refuse" },
          yolo: true,
        }),
      ),
    ).toEqual({ behavior: "allow", asked: 1 });
  });

  it("asks under unlisted: ask, and when it is unset", async () => {
    const asked = { behavior: "allow", asked: 1 };
    expect(
      await answerFor(
        specOf({ tools: { allow: [], deny: [], unlisted: "ask" } }),
      ),
    ).toEqual(asked);
    expect(await answerFor(specOf({}))).toEqual(asked);
  });

  it("carries the allow and deny lists, the reading rule and the Read patterns", () => {
    expect(
      sessionRules(
        specOf({
          tools: { allow: ["Bash(git log *)"], deny: ["Write", "Read(a/**)"] },
          reading: "open",
        }),
      ),
    ).toMatchObject({
      rules: {
        allow: ["Bash(git log *)"],
        deny: ["Write", "Read(a/**)"],
        reading: "open",
      },
      denyRead: ["a/**"],
    });
  });
});
