/**
 * @file Tests for Ork's `report` tool: offered only on a driver that cannot
 *   hold the final answer to the report schema, it keeps a report that fits the
 *   node's schema and returns each violation of one that does not; and a
 *   session on such a driver ends with the report the tool accepted, even when
 *   the tool's own result line carries none.
 */

import {
  type NodeReport,
  reportSchemaFor,
  type SessionPorts,
} from "@krapht/ork-core";
import type { DriverId } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  claudeCodeAdapter,
  handleRpc,
  orkTools,
  REPORT_TOOL,
} from "../src/index.ts";
import { CONTRACT } from "./contract/entries.ts";
import { collect, outcomeOf, resultsOf, start } from "./contract/harness.ts";

const ports: SessionPorts = {
  human: {
    ask: () => Promise.resolve("none"),
    permit: () => Promise.resolve({ allow: false, message: "no" }),
  },
};

const schema = reportSchemaFor({
  type: "claude.worker",
  output: { schema: { verdict: ["approve", "reject"] } },
});

/** The tools a session on `driver` gets, and the reports its tool kept. */
const session = (driver: DriverId) => {
  const kept: NodeReport[] = [];
  const tools = orkTools({
    nodeId: "review",
    driver,
    ports,
    report: {
      schema,
      submit: report => {
        kept.push(report);
      },
    },
  });
  return { tools, kept };
};

const ReplySchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string() })),
    isError: z.boolean().optional(),
  }),
});

/** Calls `report` with `args`; the reply's text and whether it is an error. */
const handIn = async (
  tools: ReturnType<typeof orkTools>,
  args: unknown,
): Promise<{ text: string; isError: boolean }> => {
  const reply = await handleRpc(tools, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: REPORT_TOOL, arguments: args },
  });
  const { result } = ReplySchema.parse(reply);
  return {
    text: result.content.map(c => c.text).join("\n"),
    isError: result.isError === true,
  };
};

const names = (driver: DriverId): string[] =>
  session(driver).tools.map(tool => tool.name);

describe("the report tool", () => {
  it("is offered on a driver without reportSchema, and not on claude-code", () => {
    expect(names("command-code")).toContain(REPORT_TOOL);
    expect(names("open-code")).toContain(REPORT_TOOL);
    expect(names("claude-code")).not.toContain(REPORT_TOOL);
  });

  it("lists the node's report schema as its input", async () => {
    const reply = await handleRpc(session("command-code").tools, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(JSON.stringify(reply)).toContain('"verdict"');
  });

  it("keeps a report that fits the schema", async () => {
    const { tools, kept } = session("command-code");
    const reply = await handIn(tools, {
      status: "pass",
      summary: "looks good",
      artifacts: { notes: "notes.md" },
      verdict: "approve",
    });
    expect(reply.isError).toBe(false);
    expect(kept).toEqual([
      {
        status: "pass",
        summary: "looks good",
        artifacts: { notes: "notes.md" },
        fields: { verdict: "approve" },
      },
    ]);
  });

  it("returns each violation of a report that breaks it, and keeps nothing", async () => {
    const { tools, kept } = session("command-code");
    const reply = await handIn(tools, {
      status: "maybe",
      summary: "unsure",
      verdict: "approve",
      mood: "tired",
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("call report again");
    expect(reply.text).toContain("status:");
    expect(reply.text).toContain("`mood`");
    expect(kept).toEqual([]);
  });

  it("refuses a report that lacks a field the node's schema requires", async () => {
    const { tools, kept } = session("command-code");
    const reply = await handIn(tools, { status: "pass", summary: "done" });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain("verdict:");
    expect(kept).toEqual([]);
  });
});

/** The `claude-code` contract entry, with its fake tool. */
const claudeEntry = (() => {
  const [claude] = CONTRACT;
  if (claude === undefined) throw new Error("no claude-code contract entry");
  return claude;
})();

/** The claude-code fake, run as a driver that has no report schema. */
const noSchemaEntry = {
  ...claudeEntry,
  driver: "command-code" as const,
  adapter: { ...claudeCodeAdapter, driver: "command-code" as const },
};

describe("a session on a driver without reportSchema", () => {
  it("ends with the report the tool accepted, after the refused one", async () => {
    const events = await collect(start(noSchemaEntry, "report-tool").session);
    expect(resultsOf(events, REPORT_TOOL)).toEqual([true, false]);
    expect(outcomeOf(events).report).toMatchObject({
      status: "pass",
      summary: "done",
    });
  });

  it("ends with no report when the tool accepted none", async () => {
    const events = await collect(start(noSchemaEntry, "plain").session);
    expect(outcomeOf(events).report).toBeNull();
  });
});

describe("a session on a driver with reportSchema", () => {
  it("keeps the report of its own result line", async () => {
    const events = await collect(start(claudeEntry, "plain").session);
    expect(outcomeOf(events).report).toMatchObject({ status: "pass" });
  });
});
