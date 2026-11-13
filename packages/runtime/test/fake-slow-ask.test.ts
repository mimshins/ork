/**
 * @file Tests that the fake `claude`, `cmd` and `opencode` wait for a slow
 *   `ask_user` answer. They post to Ork's endpoint through `node:http`, not the
 *   global `fetch`, whose 300 s headers timeout ended a QA stand-in's ask after
 *   five minutes ("Provider unavailable") while the user was still deciding. A
 *   preload (`fixtures/short-fetch-timeout.mjs`) lowers that timeout to 200 ms,
 *   and the endpoint here answers the ask after 1 s.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const SLOW_MS = 1000;
const ENV = {
  ...process.env,
  NODE_OPTIONS: `--import ${pathToFileURL(fixture("short-fetch-timeout.mjs")).href}`,
  SHORT_FETCH_TIMEOUT_MS: "200",
};

const RpcSchema = z.object({
  id: z.number(),
  method: z.string(),
  params: z.object({ name: z.string().optional() }).optional(),
});
type Rpc = z.infer<typeof RpcSchema>;

const result = (rpc: Rpc): unknown =>
  rpc.method === "tools/list"
    ? { tools: [{ name: "ask_user" }, { name: "report" }] }
    : {
        content: [
          {
            type: "text",
            text: rpc.params?.name === "ask_user" ? "slow answer" : "ok",
          },
        ],
      };

/** Ork's endpoint, but the answer to `ask_user` takes SLOW_MS. */
const answer = (req: IncomingMessage, res: ServerResponse): void => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    body += chunk;
  });
  req.on("end", () => {
    const rpc = RpcSchema.parse(JSON.parse(body) as unknown);
    setTimeout(
      () => {
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: result(rpc) }),
        );
      },
      rpc.params?.name === "ask_user" ? SLOW_MS : 0,
    );
  });
};

const server = createServer(answer);
let url = "";

beforeAll(async () => {
  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/mcp`;
});
afterAll(() => {
  server.close();
});

/** What a process prints, run to its end (async: the endpoint shares this loop). */
const output = (
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { ...ENV, ...options.env },
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject).on("close", () => {
      resolve(stdout);
    });
    child.stdin.end(options.stdin ?? "");
  });

const fakeClaude = (): Promise<string> =>
  output(
    fixture("fake-claude.mjs"),
    [
      "-p",
      "--mcp-config",
      JSON.stringify({ mcpServers: { ork: { url, headers: {} } } }),
    ],
    {
      stdin: `${JSON.stringify({ type: "user", message: { content: "Do the task" } })}\n`,
    },
  );

const fakeOpencode = (): Promise<string> => {
  const config = path.join(
    mkdtempSync(path.join(tmpdir(), "ork-slow-ask-")),
    "opencode.json",
  );
  writeFileSync(
    config,
    JSON.stringify({ mcp: { servers: { ork: { url, headers: {} } } } }),
  );
  return output(
    fixture("fake-opencode.mjs"),
    ["run", "--format", "json", "Do the task"],
    {
      env: { OPENCODE_CONFIG: config },
    },
  );
};

const fakeCmd = async (): Promise<string> => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-slow-ask-"));
  const env = { HOME: cwd };
  await output(
    fixture("fake-command.mjs"),
    ["mcp", "add", "--scope", "local", "ork", url],
    { cwd, env },
  );
  return output(
    fixture("fake-command.mjs"),
    ["-p", "Do the task", "--output-format", "json"],
    { cwd, env },
  );
};

/** What `fetch`, under the same preload, makes of the slow ask. */
const fetchAsk = (): Promise<string> =>
  output(process.execPath, [
    "-e",
    `fetch(${JSON.stringify(url)}, { method: "POST", body: ${JSON.stringify(
      JSON.stringify({
        id: 1,
        method: "tools/call",
        params: { name: "ask_user" },
      }),
    )} }).then(() => console.log("answered"), error => console.log(error.cause.code))`,
  ]);

describe("a slow ask_user answer", () => {
  it("is given up on by fetch once its lowered headers timeout passes", async () => {
    expect((await fetchAsk()).trim()).toBe("UND_ERR_HEADERS_TIMEOUT");
  });

  it("reaches the fake claude", async () => {
    expect(await fakeClaude()).toContain('"result":"slow answer"');
  });

  it("reaches the fake opencode", async () => {
    expect(await fakeOpencode()).toContain("asked: slow answer");
  });

  it("reaches the fake cmd", async () => {
    expect(await fakeCmd()).toContain("asked: slow answer");
  });
});
