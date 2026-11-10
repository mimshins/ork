/**
 * @file Tests for the `ask_user` tool: the session gets the person's choice
 *   back, and the note they gave with it when they gave one.
 */

import type { HumanChannel } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { handleRpc, orkTools } from "../src/index.ts";

/** A person who chooses `choice`, and says `note` with it when there is one. */
const person = (choice: string, note?: string): HumanChannel => ({
  ask: ({ onNote }) => {
    if (note !== undefined) onNote?.(note);
    return Promise.resolve(choice);
  },
  permit: () => Promise.resolve({ allow: true }),
});

/** What the session reads back from one `ask_user` call. */
const askedWith = async (human: HumanChannel): Promise<string> => {
  const tools = orkTools({
    nodeId: "spec",
    driver: "claude-code",
    ports: { human },
  });
  const reply = await handleRpc(tools, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ask_user",
      arguments: {
        question: "Which API?",
        options: [{ id: "keep" }, { id: "replace" }],
      },
    },
  });
  return JSON.stringify(reply);
};

describe("the ask_user tool", () => {
  it("says the choice", async () => {
    const reply = await askedWith(person("keep"));
    expect(reply).toContain("The user chose: keep");
    expect(reply).not.toContain("They said");
  });

  it("reports a failed question as a tool error, not as an answer", async () => {
    const failing: HumanChannel = {
      ask: () => Promise.reject(new Error("UNIQUE constraint failed")),
      permit: () => Promise.resolve({ allow: true }),
    };
    const reply = await askedWith(failing);
    expect(reply).toContain('"isError":true');
    expect(reply).toContain("UNIQUE constraint failed");
    expect(reply).not.toContain("chose");
  });

  it("says the note given with the choice", async () => {
    expect(
      await askedWith(person("replace", "Keep the old one too")),
    ).toContain(
      String.raw`The user chose: replace\nThey said: Keep the old one too`,
    );
  });
});
