/**
 * @file Tests for the `omp` guard (RFC-026): the generated module is written to
 *   a private folder, imported, and its `tool_call` and `tool_result` handlers
 *   are called as `omp` calls them, against a stand-in for Ork's hold endpoint.
 *   They cover the node's rules, the fence on file tools (the worktree, Ork's
 *   private folder, addresses with a scheme), holding a paused node's call, the
 *   `stopped` marker, freeing a `heavy` slot after a call, and failing closed.
 */

import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  guardSource,
  HELD,
  OMP_GUARD_FILE,
  OMP_HOLD_FILE,
  OMP_PAUSED,
  OMP_STOPPED_FILE,
  type OmpHoldFile,
} from "../src/adapters/omp-guard.ts";
import { makeSecretFolder } from "../src/secret-file.ts";

type ToolRuleSet = Parameters<typeof guardSource>[0];

const tmp = (name: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), `ork-omp-${name}-`)));

type Handler = (event: unknown) => Promise<unknown>;
type Guard = { call: Handler; result: Handler; dir: string; cwd: string };

const HandlerSchema = z.custom<Handler>(value => typeof value === "function");
const ModuleSchema = z.object({
  default: z.custom<(pi: unknown) => void>(
    value => typeof value === "function",
  ),
});

/**
 * Writes a guard for `rules` in a fresh private folder; `hold` is `hold.json`'s
 * text.
 */
const writeGuard = (
  rules: Partial<ToolRuleSet>,
  hold?: { expected: boolean; text?: string },
): { file: string; dir: string; cwd: string } => {
  const cwd = tmp("work");
  const folder = makeSecretFolder(tmp("secret"));
  if (hold?.text !== undefined) folder.write(OMP_HOLD_FILE, hold.text);
  const file = folder.write(
    OMP_GUARD_FILE,
    guardSource(
      { cwd, allow: [], deny: [], ...rules },
      { dir: folder.dir, hold: hold?.expected === true },
    ),
  );
  return { file, dir: folder.dir, cwd };
};

/** Loads a guard as `omp` does: its default export registers the handlers. */
const loadGuard = async (
  rules: Partial<ToolRuleSet>,
  hold?: OmpHoldFile,
): Promise<Guard> => {
  const written = writeGuard(
    rules,
    hold === undefined
      ? undefined
      : { expected: true, text: JSON.stringify(hold) },
  );
  const handlers = new Map<string, unknown>();
  const loaded = ModuleSchema.parse(
    await import(pathToFileURL(written.file).href),
  );
  loaded.default({
    on: (type: string, handler: unknown) => handlers.set(type, handler),
  });
  return {
    call: HandlerSchema.parse(handlers.get("tool_call")),
    result: HandlerSchema.parse(handlers.get("tool_result")),
    dir: written.dir,
    cwd: written.cwd,
  };
};

let calls = 0;
const call = (toolName: string, input: unknown) => {
  calls += 1;
  return {
    type: "tool_call",
    toolName,
    toolCallId: `c${String(calls)}`,
    input,
  };
};

/** What a call came to: "runs", or the guard's reason. */
const outcome = async (guard: Guard, toolName: string, input: unknown) => {
  const answer = z
    .object({ block: z.literal(true), reason: z.string() })
    .optional()
    .parse(await guard.call(call(toolName, input)));
  return answer?.reason ?? "runs";
};

type Seen = { auth: string | undefined; body: unknown };
type Reply = { status: number; body: string };
type StandIn = { hold: OmpHoldFile; seen: Seen[]; close: () => Promise<void> };

/** A stand-in for Ork's hold endpoint; `reply` decides each answer. */
const standIn = async (
  reply: (body: unknown) => Promise<Reply> | Reply = () => ({
    status: 200,
    body: "{}",
  }),
): Promise<StandIn> => {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      text += chunk;
    });
    req.on("end", () => {
      const body: unknown = JSON.parse(text);
      seen.push({ auth: req.headers.authorization, body });
      void Promise.resolve(reply(body)).then(({ status, body: out }) => {
        res.writeHead(status, { "content-type": "application/json" }).end(out);
        return null;
      });
    });
  });
  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = z.object({ port: z.number() }).parse(server.address());
  return {
    hold: {
      url: `http://127.0.0.1:${String(address.port)}/hold`,
      token: "t0k3n",
    },
    seen,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
};

const NOT_ALLOWED = "Ork: bash is not allowed for this node. Do not retry it.";

describe("the omp guard's rules", () => {
  it("refuses a bash command the node did not allow, naming the tool", async () => {
    const guard = await loadGuard({});
    expect(await outcome(guard, "bash", { command: "ls" })).toBe(NOT_ALLOWED);
  });

  it("allows a command a Bash(<prefix>) rule covers, and checks a compound line command by command", async () => {
    const guard = await loadGuard({ allow: ["Bash(git status:*)"] });
    expect(await outcome(guard, "bash", { command: "git status -s" })).toBe(
      "runs",
    );
    expect(
      await outcome(guard, "bash", { command: "git status && rm -rf x" }),
    ).toBe(NOT_ALLOWED);
  });

  it("lets Ork's own tools through, but one the node denies", async () => {
    const open = await loadGuard({});
    expect(await outcome(open, "mcp__ork_session_ork_report", {})).toBe("runs");
    expect(
      await outcome(open, "mcp__ork_session_ork_ask_user", { question: "q?" }),
    ).toBe("runs");
    const denied = await loadGuard({ deny: ["mcp__ork__ask_user"] });
    expect(
      await outcome(denied, "mcp__ork_session_ork_ask_user", {
        question: "q?",
      }),
    ).toBe(
      "Ork: mcp__ork_session_ork_ask_user is denied for this node. Do not retry it.",
    );
  });

  it("refuses a tool name it does not know, --yolo included", async () => {
    const guard = await loadGuard({ yolo: true });
    const names = [
      "eval",
      "task",
      "mcp__other__x",
      "mcp__ork_session_ork_",
      "constructor",
    ];
    const outcomes = await Promise.all(
      names.map(each => outcome(guard, each, {})),
    );
    expect(outcomes).toEqual(
      names.map(
        each => `Ork: ${each} is not a tool Ork knows. Do not retry it.`,
      ),
    );
  });

  it("lets read, grep and glob reach inside the worktree, and needs a rule outside it", async () => {
    const none = await loadGuard({});
    expect(await outcome(none, "read", { path: "src/a.ts:1-5" })).toBe("runs");
    expect(await outcome(none, "glob", { path: "**/*.ts" })).toBe("runs");
    expect(await outcome(none, "grep", { pattern: "x" })).toBe("runs");
    const outside = [
      ["read", { path: "/usr/share/dict/words" }],
      ["grep", { pattern: "x", path: "/usr" }],
      // Not ../: the test's worktree and private folder share the temp folder.
      ["glob", { path: "/usr/share/*.txt" }],
    ] as const;
    expect(
      await Promise.all(
        outside.map(([name, input]) => outcome(none, name, input)),
      ),
    ).toEqual(
      outside.map(
        ([name]) =>
          `Ork: ${name} is not allowed for this node. Do not retry it.`,
      ),
    );
    const ruled = await loadGuard({ allow: ["Read"] });
    expect(
      await Promise.all(
        outside.map(([name, input]) => outcome(ruled, name, input)),
      ),
    ).toEqual(["runs", "runs", "runs"]);
  });

  it("refuses an edit or a write whose real path is outside the worktree, --yolo included", async () => {
    const guard = await loadGuard({ yolo: true });
    const away = tmp("away");
    symlinkSync(away, path.join(guard.cwd, "link"));
    const out = [
      ["write", { path: "../x.txt", content: "x" }],
      ["write", { path: path.join(away, "x.txt"), content: "x" }],
      ["write", { path: "link/x.txt", content: "x" }],
      ["write", { path: "~/x.txt", content: "x" }],
      ["edit", { input: "[../x.ts#AB12]\n1ab|x" }],
      ["edit", { input: "[a.ts#AB12]\n1ab|x\n[../b.ts#CD34]\n2cd|y" }],
    ] as const;
    expect(
      await Promise.all(
        out.map(([name, input]) => outcome(guard, name, input)),
      ),
    ).toEqual(
      out.map(
        ([name]) =>
          `Ork: ${name} is refused outside the worktree. Do not retry it.`,
      ),
    );
    expect(
      await outcome(guard, "write", { path: "in/x.txt", content: "x" }),
    ).toBe("runs");
    expect(
      await outcome(guard, "edit", { input: "[src/a#b.ts#AB12]\n1ab|x" }),
    ).toBe("runs");
  });

  it("refuses an edit or a write that names no path it can read", async () => {
    const guard = await loadGuard({ yolo: true });
    const blind = [
      ["edit", { input: "no header\n1ab|x" }],
      ["edit", { input: "[#AB12]" }],
      ["edit", {}],
      ["write", { content: "x" }],
    ] as const;
    expect(
      await Promise.all(
        blind.map(([name, input]) => outcome(guard, name, input)),
      ),
    ).toEqual(
      blind.map(
        ([name]) =>
          `Ork: ${name} is refused when it names no path Ork can read. Do not retry it.`,
      ),
    );
  });

  it("allows an edit in the worktree with an Edit rule, and refuses it without one", async () => {
    const ruled = await loadGuard({ allow: ["Edit"] });
    expect(await outcome(ruled, "edit", { input: "[a.ts#AB12]\n1ab|x" })).toBe(
      "runs",
    );
    expect(await outcome(ruled, "write", { path: "b.ts", content: "x" })).toBe(
      "runs",
    );
    const none = await loadGuard({});
    expect(await outcome(none, "write", { path: "b.ts", content: "x" })).toBe(
      "Ork: write is not allowed for this node. Do not retry it.",
    );
  });

  it("refuses an address with a scheme and a path in Ork's private folder, --yolo included", async () => {
    const guard = await loadGuard({ yolo: true });
    expect(
      await outcome(guard, "read", { path: "https://example.com/a" }),
    ).toBe(
      "Ork: read is refused for an address with a scheme. Do not retry it.",
    );
    expect(await outcome(guard, "read", { path: "xd://x" })).toBe(
      "Ork: read is refused for an address with a scheme. Do not retry it.",
    );
    const secret = [
      ["read", { path: path.join(guard.dir, OMP_HOLD_FILE) }],
      ["read", { path: `${path.join(guard.dir, OMP_HOLD_FILE)}:1-2` }],
      ["grep", { pattern: "token", path: path.dirname(guard.dir) }],
      ["glob", { path: `${path.dirname(guard.dir)}/**/*.json` }],
      ["write", { path: path.join(guard.dir, OMP_GUARD_FILE), content: "" }],
    ] as const;
    expect(
      await Promise.all(
        secret.map(([name, input]) => outcome(guard, name, input)),
      ),
    ).toEqual(
      secret.map(
        ([name]) =>
          `Ork: ${name} is refused on Ork's private folder. Do not retry it.`,
      ),
    );
  });

  it("refuses a call when the handler throws", async () => {
    const guard = await loadGuard({ yolo: true });
    const input = {
      get command(): string {
        throw new Error("boom");
      },
    };
    expect(await outcome(guard, "bash", input)).toBe(
      "Ork: the call is refused, its rules could not be checked (boom).",
    );
  });

  it("refuses a shell read under reading: extract with the extract call to make", async () => {
    const guard = await loadGuard({ allow: ["Bash"], refuseReads: true });
    expect(await outcome(guard, "bash", { command: "cat a.ts" })).toMatch(
      /extract/u,
    );
    expect(
      await outcome(guard, "bash", { command: "pnpm test | tail -5" }),
    ).toBe("runs");
  });
});

describe("the omp guard's hold", () => {
  it("asks the hold endpoint with Ork's tool name behind the bearer token, and lets the call run on {}", async () => {
    const endpoint = await standIn();
    const guard = await loadGuard({ allow: ["Bash"] }, endpoint.hold);
    expect(await outcome(guard, "bash", { command: "ls" })).toBe("runs");
    expect(endpoint.seen).toEqual([
      {
        auth: "Bearer t0k3n",
        body: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
      },
    ]);
    await endpoint.close();
  });

  it("asks for Ork's own tools too, in Ork's words", async () => {
    const endpoint = await standIn();
    const guard = await loadGuard({}, endpoint.hold);
    expect(
      await outcome(guard, "mcp__ork_session_ork_delegate", { to: "x" }),
    ).toBe("runs");
    expect(endpoint.seen.map(each => each.body)).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "mcp__ork__delegate",
        tool_input: { to: "x" },
      },
    ]);
    await endpoint.close();
  });

  it("refuses a call the rules refuse at once, without asking", async () => {
    const endpoint = await standIn();
    const guard = await loadGuard({}, endpoint.hold);
    expect(await outcome(guard, "bash", { command: "ls" })).toBe(NOT_ALLOWED);
    expect(await outcome(guard, "eval", {})).toMatch(/not a tool Ork knows/u);
    expect(endpoint.seen).toEqual([]);
    await endpoint.close();
  });

  it("waits while the call is held, and lets it run once Ork answers", async () => {
    const release = Promise.withResolvers<Reply>();
    const endpoint = await standIn(() => release.promise);
    const guard = await loadGuard({ allow: ["Bash"] }, endpoint.hold);
    const pending = outcome(guard, "bash", { command: "ls" });
    const early = await Promise.race([pending, delay(150, "waiting")]);
    expect(early).toBe("waiting");
    expect(endpoint.seen).toHaveLength(1);
    release.resolve({ status: 200, body: "{}" });
    expect(await pending).toBe("runs");
    await endpoint.close();
  });

  it("refuses with the sentence that asks for the same call again when the pause outlasts the window", async () => {
    const endpoint = await standIn(() => ({
      status: 200,
      body: JSON.stringify(HELD),
    }));
    const guard = await loadGuard({ allow: ["Bash"] }, endpoint.hold);
    expect(await outcome(guard, "bash", { command: "ls" })).toBe(OMP_PAUSED);
    expect(OMP_PAUSED).toBe(
      "Ork paused this node, so this call did not run. Make the same call again; it waits until the node continues. Do nothing else.",
    );
    await endpoint.close();
  });

  it("refuses the call when Ork cannot be asked: down, 401, or an answer it does not know", async () => {
    const down = await standIn();
    await down.close();
    const replies: Reply[] = [
      { status: 401, body: "" },
      { status: 200, body: JSON.stringify({ go: true }) },
      { status: 200, body: "nope" },
    ];
    const endpoints = await Promise.all(
      replies.map(each => standIn(() => each)),
    );
    const guards = await Promise.all(
      [down, ...endpoints].map(each =>
        loadGuard({ allow: ["Bash"] }, each.hold),
      ),
    );
    const outcomes = await Promise.all(
      guards.map(each => outcome(each, "bash", { command: "ls" })),
    );
    expect(outcomes).toEqual([
      expect.stringMatching(
        /^Ork: bash did not run, Ork could not be asked \(.*ECONNREFUSED.*\)\.$/u,
      ),
      "Ork: bash did not run, Ork could not be asked (status 401).",
      "Ork: bash did not run, Ork could not be asked (an answer it does not know).",
      expect.stringMatching(
        /^Ork: bash did not run, Ork could not be asked \(.*JSON.*\)\.$/u,
      ),
    ]);
    await Promise.all(endpoints.map(each => each.close()));
  });

  it("refuses every call once the stopped marker exists, without asking", async () => {
    const endpoint = await standIn();
    const guard = await loadGuard({ allow: ["Bash"] }, endpoint.hold);
    writeFileSync(path.join(guard.dir, OMP_STOPPED_FILE), "");
    expect(await outcome(guard, "bash", { command: "ls" })).toBe(
      "Ork stopped this node, so this call did not run. Do nothing else.",
    );
    expect(endpoint.seen).toEqual([]);
    await endpoint.close();
  });

  it("does not run a held call when the node is stopped meanwhile, whatever Ork answers", async () => {
    const release = Promise.withResolvers<Reply>();
    const endpoint = await standIn(() => release.promise);
    const guard = await loadGuard({ allow: ["Bash"] }, endpoint.hold);
    const pending = outcome(guard, "bash", { command: "ls" });
    await delay(100);
    writeFileSync(path.join(guard.dir, OMP_STOPPED_FILE), "");
    // An aborted hold answers "go".
    release.resolve({ status: 200, body: "{}" });
    expect(await pending).toBe(
      "Ork stopped this node, so this call did not run. Do nothing else.",
    );
    await endpoint.close();
  });

  it("frees a heavy slot after a Bash call it asked about, by its call id, in any order", async () => {
    const endpoint = await standIn();
    const guard = await loadGuard({ allow: ["Bash", "Read"] }, endpoint.hold);
    const first = call("bash", { command: "pnpm build" });
    const second = call("bash", { command: "pnpm test" });
    const read = call("read", { path: "a.ts" });
    await guard.call(first);
    await guard.call(second);
    await guard.call(read);
    await guard.result({ ...second, type: "tool_result", isError: false });
    await guard.result({ ...read, type: "tool_result", isError: false });
    await guard.result({ ...first, type: "tool_result", isError: true });
    // The same id twice, and one never asked about, free nothing more.
    await guard.result({ ...first, type: "tool_result", isError: false });
    await guard.result({
      ...call("bash", { command: "x" }),
      type: "tool_result",
    });
    expect(endpoint.seen.slice(3).map(each => each.body)).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
      },
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm build" },
      },
    ]);
    await endpoint.close();
  });

  it("sends no request when the session has no hold port", async () => {
    const endpoint = await standIn();
    const written = writeGuard(
      { allow: ["Bash"] },
      { expected: false, text: JSON.stringify(endpoint.hold) },
    );
    const handlers = new Map<string, unknown>();
    ModuleSchema.parse(await import(pathToFileURL(written.file).href)).default({
      on: (type: string, handler: unknown) => handlers.set(type, handler),
    });
    const guard = {
      call: HandlerSchema.parse(handlers.get("tool_call")),
      result: HandlerSchema.parse(handlers.get("tool_result")),
      ...written,
    };
    const each = call("bash", { command: "ls" });
    expect(await guard.call(each)).toBeUndefined();
    await guard.result({ ...each, type: "tool_result" });
    expect(endpoint.seen).toEqual([]);
    await endpoint.close();
  });
});

describe("loading the omp guard", () => {
  it("throws when the hold.json it expects is missing or names no URL and token", async () => {
    const missing = writeGuard({}, { expected: true });
    await expect(import(pathToFileURL(missing.file).href)).rejects.toThrow(
      /ENOENT/u,
    );
    const empty = writeGuard({}, { expected: true, text: "{}" });
    await expect(import(pathToFileURL(empty.file).href)).rejects.toThrow(
      /hold\.json names no hold URL and token/u,
    );
  });

  it("holds no token in its source", () => {
    const dir = tmp("src");
    mkdirSync(path.join(dir, "x"));
    const source = guardSource(
      { cwd: dir, allow: [], deny: [] },
      { dir: path.join(dir, "x"), hold: true },
    );
    expect(source).not.toMatch(/t0k3n|Bearer [a-z0-9]/u);
  });
});
