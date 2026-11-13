/**
 * @file Test fixtures for the server: a server on a free port with `HOME` in a
 *   temp folder, a second connection to its store that plays the runs' own
 *   processes, stored runs with their events, and a fake `ork` script that
 *   detached starts and resumes run instead of the real one.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type GhRunner,
  openStore,
  type RunEvent,
  type RunResult,
  storePath,
} from "@krapht/ork-core";
import { expect } from "vitest";
import { z } from "zod";

import { createClient, type ServerOptions, startServer } from "../src/index.ts";

export const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/**
 * A fake `ork` script for detached starts: it records its arguments, then
 * begins (`run … --run-id <id>`) or reopens (`resume <id>`) the run in the
 * store at `ORK_TEST_STORE`, and stays alive briefly as the run's process.
 */
export const fakeOrk = (store: string): { script: string; args: string } => {
  const dir = temp("ork-srv-fake-");
  const script = path.join(dir, "fake-ork.ts");
  const args = path.join(dir, "args.json");
  const core = path.resolve(import.meta.dirname, "../../core/src/index.ts");
  writeFileSync(
    script,
    [
      `import { writeFileSync } from "node:fs";`,
      `import { openStore } from ${JSON.stringify(core)};`,
      `const argv = process.argv.slice(2);`,
      `writeFileSync(${JSON.stringify(args)}, JSON.stringify({ argv, cwd: process.cwd(), detached: process.env.ORK_DETACHED }));`,
      `const store = openStore(${JSON.stringify(store)});`,
      `if (argv[0] === "resume") store.reopen(argv[1]);`,
      `else store.begin({ id: argv[argv.indexOf("--run-id") + 1], workflow: "demo", file: argv[1], project: process.cwd() });`,
      `store.close();`,
      `setTimeout(() => {}, 1500);`,
      "",
    ].join("\n"),
  );
  return { script, args };
};

const ArgsSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  detached: z.string(),
});

export const readArgs = (file: string) =>
  ArgsSchema.parse(JSON.parse(readFileSync(file, "utf8")));

/** A registered in-repo project with one workflow, `demo`. */
const project = (store: EventStore) => {
  const root = temp("ork-srv-project-");
  const dir = path.join(root, ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(
    path.join(dir, "workflows", "demo.ork.yaml"),
    "schemaVersion: 1\nname: demo\nnodes: {}\n",
  );
  return store.addProject({ id: "demo", root, mode: "in-repo", dir });
};

export const startTestServer = async (
  options: { ui?: readonly string[]; gh?: GhRunner } & Pick<
    ServerOptions,
    "update" | "restart" | "sessionSecret" | "noteScrub"
  > = {},
) => {
  const home = temp("ork-srv-home-");
  const fake = fakeOrk(storePath(home));
  const server = await startServer({
    version: "9.9.9",
    port: 0,
    home,
    script: fake.script,
    ...options,
    log: () => {
      // The tests read the answers.
    },
  });
  const store = openStore(storePath(home));
  return {
    home,
    /** The arguments the fake `ork` was last started with. */
    lastArgs: () => readArgs(fake.args),
    server,
    store,
    project: project(store),
    client: createClient({ base: server.url, token: server.token }),
    /** A request with the bearer token. */
    get: (target: string, headers: Record<string, string> = {}) =>
      fetch(`${server.url}${target}`, {
        headers: { authorization: `Bearer ${server.token}`, ...headers },
      }),
    close: async () => {
      await server.close();
      store.close();
    },
  };
};

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

export const started = (runId: string): RunEvent => ({
  type: "run.started",
  runId,
  workflow: "demo",
  entries: ["lead"],
  nodes: [
    { id: "lead", type: "agent.leader" },
    { id: "check", type: "tool.shell", parent: "lead" },
  ],
});

export const nodeStarted = (id: string): RunEvent => ({
  type: "node.started",
  id,
  nodeType: id === "lead" ? "agent.leader" : "tool.shell",
  round: 1,
});

const result = (runId: string, status: RunResult["status"]): RunResult => ({
  runId,
  status,
  costUsd: 0,
  nodes: [],
  reasons: [],
  worktrees: [],
});

export const finished = (
  runId: string,
  status: RunResult["status"] = "succeeded",
): RunEvent => ({ type: "run.finished", result: result(runId, status) });

/** A run of the `demo` workflow, live in this process, with its start. */
export const liveRun = (fixture: TestServer, id: string) => {
  const run = fixture.store.begin({
    id,
    workflow: "demo",
    file: path.join(fixture.project.dir, "workflows", "demo.ork.yaml"),
    project: fixture.project.root,
  });
  fixture.store.append(id, started(id));
  fixture.store.append(id, nodeStarted("lead"));
  return run;
};

/** An open decision of a run. */
export const openGate = (fixture: TestServer, runId: string, id: string) =>
  fixture.store.openDecision({
    id,
    runId,
    node: "lead",
    kind: "question",
    question: "Ship it?",
    options: [
      { id: "ship", label: "Ship" },
      { id: "hold", label: "Hold" },
    ],
    recommended: "hold",
  });

/** A raw request, for headers `fetch` will not send (`Host`). */
export const rawGet = (
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = request(url, { headers }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
    req.end();
  });

export type SseEvent = { event: string; id?: string; data: unknown };

/**
 * Reads Server-Sent Events from a response: each event to `seen` as it comes,
 * until the stream ends or `stop` aborts.
 */
export const readSse = (response: Response, stop: AbortSignal) => {
  const seen: SseEvent[] = [];
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string): void => {
    const event: SseEvent = { event: "message", data: null };
    for (const line of block.split("\n")) {
      const [field, ...rest] = line.split(": ");
      const value = rest.join(": ");
      if (field === "event") event.event = value;
      if (field === "id") event.id = value;
      if (field === "data") event.data = JSON.parse(value);
    }
    if (event.data !== null) seen.push(event);
  };
  const done = (async () => {
    stop.addEventListener("abort", () => {
      void reader?.cancel();
    });
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- one chunk at a time, in order
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) return;
      const value: unknown = chunk.value;
      if (value instanceof Uint8Array) {
        buffer += decoder.decode(value, { stream: true });
      }
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) parse(block);
    }
  })().catch(() => {
    // Cancelled by `stop`.
  });
  return { seen, done };
};

/** Matches any text, or text that contains `part`, inside an expected object. */
export const text = (part?: string): unknown =>
  part === undefined ? expect.any(String) : expect.stringContaining(part);

/** The `name=value` of the session cookie a response sets. */
export const sessionOf = (response: Response): string =>
  (response.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";

/** The run id of an accepted start or resume, or "" when it was refused. */
export const runIdOf = (
  answer: { ok: true; data: { runId: string } } | { ok: false },
): string => (answer.ok ? answer.data.runId : "");

/** A registry that answers `latest` (or fails), and lists what it was asked. */
export const fakeRegistry = (
  latest: string | null,
  /** Other dist-tags it answers with, such as `canary`. */
  tags: Readonly<Record<string, string>> = {},
) => {
  const asked: string[] = [];
  const fetch = (input: string | URL | Request): Promise<Response> => {
    asked.push(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(
      latest === null
        ? Response.json({}, { status: 503 })
        : Response.json({ ...tags, latest }),
    );
  };
  return { fetch, asked };
};

/** The code of a minted sign-in, or "" when it was refused. */
export const codeOf = (
  answer: { ok: true; data: { code: string } } | { ok: false },
): string => (answer.ok ? answer.data.code : "");

/**
 * A finished Claude session on node `n` of a run, costing `costUsd`, for the
 * usage ledger.
 */
export const spend = (
  fixture: TestServer,
  runId: string,
  costUsd: number,
): void => {
  fixture.store.append(runId, {
    type: "node.event",
    id: "n",
    event: {
      type: "session.finished",
      outcome: {
        subtype: "success",
        sessionId: "s",
        report: null,
        text: "",
        usage: {
          costUsd,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          turns: 1,
          durationMs: 1,
        },
        errors: [],
      },
    },
  });
};
