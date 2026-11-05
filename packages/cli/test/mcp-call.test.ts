/**
 * @file The real `mcp.call` from the command line: a run reads a server from
 *   `.mcp.json` and passes its result on, a secret stays masked, and what would
 *   stop the node stops the run before it starts.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const FIXTURE = path.resolve(
  import.meta.dirname,
  "../../nodes/test/fixtures/echo-mcp-server.ts",
);
const SECRET = "marker-secret-value-42";

const WORKFLOW = `schemaVersion: 1
name: m
nodes:
  ask:
    type: mcp.call
    server: echo
    tool: echo
    arguments: { id: ENG-7 }
    output: { schema: { id: string } }
  env:
    type: mcp.call
    server: echo
    tool: env
  show:
    type: tool.shell
    env: { GOT: "{{nodes.ask.output.json.id}}", TEXT: "{{nodes.env.output.text}}" }
    script: echo "got $GOT, $TEXT"
edges:
  - { from: ask, to: env, when: "json.id == 'ENG-7'" }
  - env -> show
`;

const run = (
  place: { home: string; repo: string },
  env: Record<string, string> = {},
) =>
  spawnSync(process.execPath, [BIN, "run", "m.ork.yaml"], {
    cwd: place.repo,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: place.home,
      ORK_NO_UPDATE_CHECK: "1",
      ...env,
    },
  });

describe("mcp.call from the command line", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const project = () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-mcp-")));
    dirs.push(root);
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    mkdirSync(home);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "m.ork.yaml"), WORKFLOW);
    writeFileSync(
      path.join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          echo: {
            command: process.execPath,
            args: [FIXTURE],
            env: { PROBE_TOKEN: "${PROBE_TOKEN}" },
          },
        },
      }),
    );
    return { home, repo };
  };

  it("runs, passes its result on, and keeps a secret out of the store", () => {
    const place = project();
    const done = run(place, { PROBE_TOKEN: SECRET });
    expect(done.stderr).toBe("");
    expect(done.status).toBe(0);
    const store = openStore(storePath(place.home));
    const [record] = store.runs();
    const events = store.events(String(record?.id)).map(s => s.event);
    store.close();
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).toContain("got ENG-7, token [masked]");
  });

  it("does not start when a variable the server reads is not set", () => {
    const place = project();
    const done = run(place);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain(
      "ask: .mcp.json reads PROBE_TOKEN, which is not set",
    );
    const store = openStore(storePath(place.home));
    const runs = store.runs();
    store.close();
    expect(runs).toEqual([]);
  });

  it("does not start with a server that isn't there", () => {
    const place = project();
    writeFileSync(
      path.join(place.repo, ".mcp.json"),
      JSON.stringify({ mcpServers: {} }),
    );
    const done = run(place, { PROBE_TOKEN: SECRET });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("no MCP server `echo`");
  });
});
