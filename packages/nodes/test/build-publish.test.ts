/**
 * @file Runs this repository's own `build` workflow from the leader to the
 *   publish steps for real against a bare remote, with fake sessions and fake
 *   `gh` and `pnpm`: its tool steps are the shipped scripts. A clean rebase is
 *   checked then pushed; a conflict goes through the resolver, the check runs
 *   again on the resolved tree, and only then the push; a change in behaviour
 *   is asked about, and `stop` leaves the rebase open and pushes nothing.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileWorkflow,
  fileLockLedgers,
  loadAgents,
  type NodeExecutor,
  type NodeOutput,
  type RunEvent,
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gateExecutor, spawnTool, toolExecutor } from "../src/index.ts";

const TEXT = readFileSync(
  new URL("../../../.ork/workflows/build.ork.yaml", import.meta.url),
  "utf8",
);

const parsedOrThrow = () => {
  const parsed = parseWorkflow(TEXT);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** Compiled with the repository's own agents (`ui-designer`, `reviewer`, …). */
const compiledBuild = () =>
  compileWorkflow(parsedOrThrow(), {
    catalog: loadAgents({
      projectRoot: fileURLToPath(new URL("../../..", import.meta.url)),
      home: tmpdir(),
    }),
  });

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });

/** A `gh` that only knows a pull request is not there yet, and creates one. */
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$LOG_DIR/log"
case "$1 $2" in
  "pr view") exit 1 ;;
  "pr create") echo https://example.test/pull/1 ;;
  *) exit 1 ;;
esac
`;

/** A `pnpm` that records where and on which commit the check ran. */
const FAKE_PNPM = `#!/bin/sh
echo "pnpm $* @ $(git rev-parse HEAD)" >> "$LOG_DIR/log"
`;

type World = { base: string; project: string; remote: string };

const world = (): World => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-publish-")));
  const remote = path.join(base, "remote.git");
  const project = path.join(base, "app");
  mkdirSync(path.join(base, "bin"));
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "init", "-q", "-b", "main", project);
  for (const [key, value] of [
    ["user.name", "t"],
    ["user.email", "t@example.com"],
    ["commit.gpgsign", "false"],
  ] as const) {
    git(project, "config", key, value);
  }
  writeFileSync(path.join(project, "app.txt"), "base\n");
  git(project, "add", "app.txt");
  git(project, "commit", "-q", "-m", "base");
  git(project, "remote", "add", "origin", remote);
  git(project, "push", "-q", "-u", "origin", "main");
  for (const [name, text] of [
    ["gh", FAKE_GH],
    ["pnpm", FAKE_PNPM],
  ] as const) {
    const bin = path.join(base, "bin", name);
    writeFileSync(bin, text);
    chmodSync(bin, 0o755);
  }
  return { base, project, remote };
};

type Script = {
  /** What the change writes to `app.txt`. */
  change: string;
  /** What lands on origin's main while the build ran, if anything. */
  upstream?: string;
  /** What the resolver leaves in `app.txt`, and what it says of it. */
  resolution?: { text: string; behaviour: string };
  /** The choice at the `decide` gate, and the note that names the branch. */
  choice: string;
  note?: string;
  answer?: string;
  /** The `docs` session fails instead of reporting. */
  docsFails?: boolean;
};

const report = (output: NodeOutput) =>
  Promise.resolve({ ok: true as const, output });

const leader: NodeExecutor = () =>
  report({ status: "pass", summary: "built", decisions: [], unchecked: "" });

const run = async (w: World, script: Script) => {
  const events: RunEvent[] = [];
  const asked: string[] = [];
  vi.stubEnv(
    "PATH",
    `${path.join(w.base, "bin")}:${process.env["PATH"] ?? ""}`,
  );
  vi.stubEnv("LOG_DIR", w.base);
  const tool = toolExecutor(spawnTool, { environ: process.env });
  let docsDir = "";
  const agent: NodeExecutor = context => {
    const { id, runId } = context;
    if (id.startsWith("review.")) {
      return report({
        status: "pass",
        summary: "fine",
        findings: "",
        notes: "",
        unchecked: "",
      });
    }
    if (id === "docs" && script.docsFails === true) {
      return Promise.resolve({
        ok: false as const,
        error: "it broke",
        output: { status: "fail", summary: "it broke" },
      });
    }
    if (id === "docs") {
      // The leader's worktree, with the change and a changeset, nothing staged.
      docsDir = path.join(w.base, "wt-docs");
      git(
        w.project,
        "worktree",
        "add",
        "-q",
        "-b",
        "ork/docs",
        docsDir,
        "HEAD",
      );
      writeFileSync(path.join(docsDir, "app.txt"), script.change);
      mkdirSync(path.join(docsDir, ".changeset"));
      writeFileSync(
        path.join(docsDir, ".changeset", "c.md"),
        "---\n---\n\nc\n",
      );
      if (script.upstream !== undefined) {
        const other = path.join(w.base, "other");
        git(w.base, "clone", "-q", w.remote, other);
        git(other, "config", "user.name", "t");
        git(other, "config", "user.email", "t@example.com");
        writeFileSync(path.join(other, "app.txt"), script.upstream);
        git(other, "commit", "-q", "-am", "upstream");
        git(other, "push", "-q", "origin", "main");
      }
      return report({
        status: "pass",
        summary: "synced",
        worktree: docsDir,
        branch: "ork/docs",
        commitSubject: "Change app",
        commitBody: "Why.",
        adrs: [],
      });
    }
    if (id === "resolve") {
      const { text, behaviour } = script.resolution ?? {
        text: "base\n",
        behaviour: "unchanged",
      };
      writeFileSync(path.join(docsDir, "app.txt"), text);
      return report({ status: "pass", summary: "x", kept: "both", behaviour });
    }
    throw new Error(`Unexpected agent ${id} of ${runId}`);
  };
  const compiled = compiledBuild();
  if (compiled.graph === null) throw new Error("build does not compile");
  const ran: string[] = [];
  const result = await startRun({
    graph: compiled.graph,
    inputs: { plan: "a plan" },
    cwd: w.project,
    executors: {
      "tool.shell": tool,
      "tool.git": tool,
      "agent.leader": leader,
      "agent.worker": agent,
      "human.gate": gateExecutor,
    },
    human: {
      ask: question => {
        if (question.nodeId === "decide") {
          question.onNote?.(script.note ?? "");
          return Promise.resolve(script.choice);
        }
        if (question.nodeId === "ratify") return Promise.resolve("continue");
        asked.push(question.document ?? "");
        return Promise.resolve(script.answer ?? "keep");
      },
      permit: () => Promise.resolve({ allow: true }),
    },
    locks: fileLockLedgers({
      dir: path.join(w.base, "locks"),
      repo: w.project,
      project: w.project,
      pollMs: 10,
    }),
    onEvent: event => {
      events.push(event);
      if (event.type === "node.started") ran.push(event.id);
    },
  }).done;
  return { result, ran, asked, events, docsDir };
};

const log = (w: World): string[] =>
  readFileSync(path.join(w.base, "log"), "utf8").trim().split("\n");

const remoteFile = (w: World, branch: string): string =>
  git(w.remote, "show", `${branch}:app.txt`);

describe("the build workflow", () => {
  it("is in canonical form and checks with no finding", () => {
    expect(serializeWorkflow(parsedOrThrow())).toBe(TEXT);
    expect(compiledBuild().diagnostics).toEqual([]);
  });
});

describe("build's publish steps", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks a clean rebase once, then pushes it to main", async () => {
    const w = world();
    const { result, ran } = await run(w, { change: "new\n", choice: "main" });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(ran).not.toContain("inspect");
    expect(ran).not.toContain("resolve");
    expect(remoteFile(w, "main")).toBe("new\n");
    expect(
      log(w).filter(line => line.startsWith("pnpm run check")),
    ).toHaveLength(1);
  });

  it("does not start the resolver, or take the lock, when `docs` fails", async () => {
    const w = world();
    const { result, ran, events } = await run(w, {
      change: "new\n",
      choice: "main",
      docsFails: true,
    });
    expect(result.status).toBe("failed");
    expect(ran).toContain("docs");
    for (const id of ["resolve", "inspect", "publish", "check"]) {
      expect(ran).not.toContain(id);
    }
    expect(events.filter(event => event.type === "lock.taken")).toEqual([]);
  });

  it("resolves a conflict, checks the resolved tree, then pushes and opens the pull request", async () => {
    const w = world();
    const { result, ran, asked, events } = await run(w, {
      change: "base\nchange\n",
      upstream: "base\nupstream\n",
      resolution: { text: "base\nupstream\nchange\n", behaviour: "unchanged" },
      choice: "branch",
      note: "feature",
    });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(ran).toEqual(
      expect.arrayContaining([
        "inspect",
        "resolve",
        "settle",
        "finish",
        "check",
      ]),
    );
    expect(ran).not.toContain("ask");
    expect(remoteFile(w, "feature")).toBe("base\nupstream\nchange\n");
    const pushed = git(w.remote, "rev-parse", "feature").trim();
    const checks = log(w).filter(line => line.startsWith("pnpm run check"));
    expect(checks).toEqual([`pnpm run check @ ${pushed}`]);
    expect(log(w).filter(line => line.startsWith("gh pr create"))).toHaveLength(
      1,
    );
    // One hold on the main lock, from the publish to the end.
    expect(
      events.filter(event => event.type === "lock.taken").length,
    ).toBeGreaterThan(0);
    expect(events.filter(event => event.type === "lock.released")).toHaveLength(
      1,
    );
  });

  it("asks when the resolution changes behaviour, and pushes nothing at `stop`", async () => {
    const w = world();
    const { result, ran, asked, docsDir } = await run(w, {
      change: "limit = 20\n",
      upstream: "limit = 30\n",
      resolution: { text: "limit = 25\n", behaviour: "changed" },
      choice: "branch",
      note: "feature",
      answer: "stop",
    });
    expect(result.status).toBe("failed");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("+limit = 25");
    expect(ran).toContain("stop");
    expect(ran).not.toContain("finish");
    expect(ran).not.toContain("push");
    expect(git(w.remote, "branch", "--list", "feature")).toBe("");
    // The rebase is still open in the worktree, with the resolution staged.
    expect(git(docsDir, "status", "--porcelain")).toContain("app.txt");
  });
});
