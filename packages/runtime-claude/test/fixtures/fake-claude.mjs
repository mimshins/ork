#!/usr/bin/env node
/**
 * @file A stand-in for `claude -p` in stream-json mode, for the CLI driver's
 *   tests. It reads the brief from stdin, asks the user through Ork's MCP
 *   server (as the real CLI would call the ask_user tool), and ends with a
 *   structured report, like the real CLI's first result in print mode. With
 *   `--resume` it says which session it resumed.
 */

import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const mcp = JSON.parse(flag("--mcp-config")).mcpServers.ork;
const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);

const rpc = async (method, params) => {
  const response = await fetch(mcp.url, {
    method: "POST",
    headers: { ...mcp.headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
};

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const brief = JSON.parse(line).message.content;
  const resumed = args.includes("--resume") ? ` (resuming ${flag("--resume")})` : "";
  out({ type: "system", subtype: "init", session_id: "fake-1", model: flag("--model") ?? "fake", cwd: process.cwd() });
  out({
    type: "assistant",
    message: {
      id: "m1",
      content: [
        { type: "text", text: `Working on: ${brief}${resumed}` },
        { type: "tool_use", id: "t1", name: "mcp__ork__ask_user", input: {} },
      ],
    },
  });
  const tools = await rpc("tools/list", {});
  const answer = await rpc("tools/call", {
    name: "ask_user",
    arguments: {
      question: "Which approach?",
      options: [{ id: "a" }, { id: "b" }],
      recommended: "a",
    },
  });
  out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } });
  out({
    type: "result",
    subtype: "success",
    session_id: "fake-1",
    result: answer.result.content[0].text,
    structured_output: {
      status: "pass",
      summary: `tools: ${tools.result.tools.map(t => t.name).join(",")}`,
      artifacts: { notes: "notes.md" },
      verdict: "approve",
    },
    total_cost_usd: 0.0123,
    num_turns: 2,
    duration_ms: 1500,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 },
  });
  // Ork ends the session at its first result.
  break;
}
