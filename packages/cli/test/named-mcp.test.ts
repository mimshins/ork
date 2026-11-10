/**
 * @file Tests that the sessions the CLI starts itself, outside the scheduler
 *   (`ork run --node` and `ork chat`), load the MCP servers their node names
 *   (ADR-067), as a run's do. The runtime is the stand-in `claude`, watched for
 *   the specs it is given.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentRuntime,
  type EventStore,
  type HumanChannel,
  openStore,
  type SessionSpec,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { describe, expect, it } from "vitest";

import { resumeChat, runNode, runWorkflowFile } from "../src/index.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "nodes:",
  "  write:",
  "    type: claude.worker",
  "    isolation: shared",
  "    mcp: [browser]",
  '    prompt: "Write"',
  "",
].join("\n");

const BROWSER = { command: "npx", env: { TOKEN: "${SECRET_TOKEN}" } };

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const quiet = () => {
  // The transcript isn't what these check.
};

const recordOf = (store: EventStore, runId: string | undefined) => {
  const record = store.runs().find(({ id }) => id === runId);
  if (record === undefined) throw new Error(`no run ${String(runId)}`);
  return record;
};

const setup = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-named-mcp-")));
  writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
  writeFileSync(
    path.join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: { browser: BROWSER } }),
  );
  const specs: SessionSpec[] = [];
  const runtime = (): Promise<AgentRuntime> => {
    const inner = createCliRuntime({ bin: FAKE_CLAUDE });
    return Promise.resolve({
      driver: "claude-code",
      start: (spec, ports) => {
        specs.push(spec);
        return inner.start(spec, ports);
      },
    });
  };
  const shared = {
    file: "notes.ork.yaml",
    cwd: dir,
    inputs: [],
    inPlace: true,
    json: false,
    runtime,
    driverChecks: readyOnly("claude-code"),
    human,
    store: openStore(":memory:"),
    home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
    out: quiet,
    err: quiet,
  };
  return { shared, specs, runtime };
};

describe("a node's named MCP servers outside the scheduler", () => {
  it("load on `ork run --node`", async () => {
    const { shared, specs } = setup();
    const done = await runNode({ ...shared, nodeId: "write" });

    expect(done.exitCode).toBe(0);
    expect(specs[0]?.mcpServers).toEqual({ browser: BROWSER });
  });

  it("load when `ork chat` resumes the node's session", async () => {
    const { shared, specs, runtime } = setup();
    const done = await runWorkflowFile({
      ...shared,
      tools: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    });
    const record = recordOf(shared.store, done.result?.runId);
    specs.length = 0;

    const failure = await resumeChat({
      store: shared.store,
      run: record,
      node: "write",
      body: "One more line.",
      runtime,
      human,
      out: quiet,
    });

    expect(failure).toBeNull();
    expect(specs[0]?.mcpServers).toEqual({ browser: BROWSER });
  });
});
