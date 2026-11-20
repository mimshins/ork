/**
 * @file Runs this repository's own `rfc` workflow from the draft to the publish
 *   step for real against a bare remote, with a fake draft session and fake
 *   `gh` and `pnpm`: its tool steps are the shipped scripts. When another RFC
 *   took our number on origin first, the publish renumbers ours onto the next
 *   free number and pushes one commit on top of upstream; a commit with other
 *   files is renumbered in place and rebased.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
  startRun,
} from "@krapht/ork-core";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gateExecutor, spawnTool, toolExecutor } from "../src/index.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const TEXT = readFileSync(
  path.join(ROOT, ".ork", "workflows", "rfc.ork.yaml"),
  "utf8",
);

const parsedOrThrow = () => {
  const parsed = parseWorkflow(TEXT);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const compiledRfc = () =>
  compileWorkflow(parsedOrThrow(), {
    catalog: loadAgents({ projectRoot: ROOT, home: tmpdir() }),
  });

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$LOG_DIR/log"
case "$1 $2" in
  "pr view") exit 1 ;;
  "pr create") echo https://example.test/pull/1 ;;
  *) exit 1 ;;
esac
`;

const FAKE_PNPM = `#!/bin/sh
echo "pnpm $*" >> "$LOG_DIR/log"
`;

const THEIRS = "RFC-027-theirs.md";
const OURS = "RFC-027-ours.md";
const RENUMBERED = "RFC-028-ours.md";

const HEAD = [
  "| RFC                                  | Title   | Status      |",
  "| ------------------------------------ | ------- | ----------- |",
  "| [026](./archived/RFC-026-old-one.md) | Old one | Implemented |",
].join("\n");

const row = (number: string, file: string, title: string): string =>
  `| [${number}](./active/${file}) | ${title} | Accepted |`;

const rfc = (number: string, title: string): string =>
  `# RFC-${number} — ${title}\n\n- **Status:** Accepted\n\nSee RFC-${number}.\n`;

const put = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

const identify = (cwd: string): void => {
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
};

type World = { base: string; project: string; remote: string };

const world = (): World => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-rfc-pub-")));
  const remote = path.join(base, "remote.git");
  const project = path.join(base, "app");
  mkdirSync(path.join(base, "bin"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", project]);
  identify(project);
  put(project, "rfcs/README.md", `# RFCs\n\n${HEAD}\n`);
  put(project, "rfcs/archived/RFC-026-old-one.md", rfc("026", "Old one"));
  for (const file of ["renumber.ts", "index-table.ts"]) {
    mkdirSync(path.join(project, "tools", "rfcs"), { recursive: true });
    copyFileSync(
      path.join(ROOT, "tools", "rfcs", file),
      path.join(project, "tools", "rfcs", file),
    );
  }
  git(project, "add", "-A");
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

const otherClone = (w: World): string => path.join(w.base, "other");

/** Another RFC-027 reaches origin's main, from a second clone. */
const upstreamTakes = (w: World): void => {
  const other = otherClone(w);
  execFileSync("git", ["clone", "-q", w.remote, other], { stdio: "pipe" });
  identify(other);
  const index = readFileSync(path.join(other, "rfcs/README.md"), "utf8");
  put(other, `rfcs/active/${THEIRS}`, rfc("027", "Theirs"));
  put(
    other,
    "rfcs/README.md",
    `${index.trimEnd()}\n${row("027", THEIRS, "Theirs")}\n`,
  );
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "theirs");
  git(other, "push", "-q", "origin", "main");
};

type Script = {
  /** Other files our commit holds, besides the RFC. */
  extra?: Record<string, string>;
  /** Our commit adds no index row. */
  noRow?: boolean;
  choice: "main" | "branch";
  note?: string;
  /** Written to origin before the publish: the clone, and the tip it makes. */
  before: (w: World) => void;
};

const run = async (w: World, script: Script) => {
  vi.stubEnv(
    "PATH",
    `${path.join(w.base, "bin")}:${process.env["PATH"] ?? ""}`,
  );
  vi.stubEnv("LOG_DIR", w.base);
  const tool = toolExecutor(spawnTool, { environ: process.env });
  const draft: NodeExecutor = () => {
    const dir = path.join(w.base, "wt-rfc");
    git(w.project, "worktree", "add", "-q", "-b", "ork/rfc", dir, "HEAD");
    const index = readFileSync(path.join(dir, "rfcs/README.md"), "utf8");
    put(dir, `rfcs/active/${OURS}`, rfc("027", "Ours"));
    if (script.noRow !== true) {
      put(
        dir,
        "rfcs/README.md",
        `${index.trimEnd()}\n${row("027", OURS, "Ours")}\n`,
      );
    }
    for (const [file, text] of Object.entries(script.extra ?? {})) {
      put(dir, file, text);
    }
    script.before(w);
    return Promise.resolve({
      ok: true as const,
      output: {
        status: "pass",
        summary: "drafted",
        rfc: `rfcs/active/${OURS}`,
        path: `rfcs/active/${OURS}`,
        commitSubject: "Add RFC-027 on ours",
        commitBody: "Why.",
        worktree: dir,
      },
    });
  };
  const compiled = compiledRfc();
  if (compiled.graph === null) throw new Error("rfc does not compile");
  const result = await startRun({
    graph: compiled.graph,
    inputs: { brief: "a brief" },
    cwd: w.project,
    executors: {
      "tool.shell": tool,
      "tool.git": tool,
      "agent.worker": draft,
      "human.gate": gateExecutor,
    },
    human: {
      ask: question => {
        question.onNote?.(script.note ?? "");
        return Promise.resolve(script.choice);
      },
      permit: () => Promise.resolve({ allow: true }),
    },
    locks: fileLockLedgers({
      dir: path.join(w.base, "locks"),
      repo: w.project,
      project: w.project,
      pollMs: 10,
    }),
    onEvent: () => {},
  }).done;
  return result;
};

const files = (w: World, ref: string): string[] =>
  git(w.remote, "ls-tree", "-r", "--name-only", ref, "--", "rfcs")
    .split("\n")
    .toSorted();

const show = (w: World, ref: string, file: string): string =>
  execFileSync("git", ["-C", w.remote, "show", `${ref}:${file}`], {
    encoding: "utf8",
  });

/** Commits on `ref` that `tip` does not have, newest first (subjects). */
const above = (w: World, tip: string, ref: string): string[] =>
  git(w.remote, "log", "--format=%s", `${tip}..${ref}`)
    .split("\n")
    .filter(line => line !== "");

describe("the rfc workflow", () => {
  it("is in canonical form, checks with no finding and locks main to publish", () => {
    expect(serializeWorkflow(parsedOrThrow())).toBe(TEXT);
    expect(compiledRfc().diagnostics).toEqual([]);
    const publish = parsedOrThrow().nodes["publish"];
    expect(publish).toMatchObject({ lock: "branch:main" });
  });
});

describe("rfc's publish step", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renumbers our RFC when another took its number on main, and pushes one commit on top", async () => {
    const w = world();
    const result = await run(w, { choice: "main", before: upstreamTakes });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    const names = files(w, "main");
    expect(names).toContain(`rfcs/active/${THEIRS}`);
    expect(names).toContain(`rfcs/active/${RENUMBERED}`);
    expect(names).not.toContain(`rfcs/active/${OURS}`);
    expect(names.filter(name => name.includes("RFC-027"))).toHaveLength(1);
    expect(show(w, "main", `rfcs/active/${RENUMBERED}`)).toContain(
      "# RFC-028 — Ours",
    );
    const index = show(w, "main", "rfcs/README.md");
    expect(index).toContain("[027](./active/RFC-027-theirs.md)");
    expect(index).toContain("[028](./active/RFC-028-ours.md)");
    expect(index).not.toContain(OURS);
    expect(above(w, "main~1", "main")).toEqual(["Add RFC-027 on ours"]);
    expect(show(w, "main~1", `rfcs/active/${THEIRS}`)).toContain("Theirs");
    expect(git(w.project, "rev-parse", "main")).toBe(
      git(w.remote, "rev-parse", "main"),
    );
  });

  it("keeps the number when nothing took it", async () => {
    const w = world();
    const result = await run(w, { choice: "main", before: () => {} });
    expect(result.status).toBe("succeeded");
    expect(files(w, "main")).toContain(`rfcs/active/${OURS}`);
  });

  it("renumbers against main and replays on an existing base branch", async () => {
    const w = world();
    const result = await run(w, {
      choice: "branch",
      note: "feature",
      before: ours => {
        upstreamTakes(ours);
        const other = otherClone(ours);
        // `feature` branches off the base and holds an unrelated commit.
        git(other, "checkout", "-q", "-b", "feature", "main~1");
        put(other, "notes.txt", "n\n");
        git(other, "add", "-A");
        git(other, "commit", "-q", "-m", "notes");
        git(other, "push", "-q", "origin", "feature");
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(files(w, "feature")).toEqual([
      "rfcs/README.md",
      `rfcs/active/${RENUMBERED}`,
      "rfcs/archived/RFC-026-old-one.md",
    ]);
    expect(above(w, "feature~1", "feature")).toEqual(["Add RFC-027 on ours"]);
    expect(git(w.remote, "log", "-1", "--format=%s", "feature~1")).toBe(
      "notes",
    );
    expect(show(w, "feature", "rfcs/README.md")).toContain("[028]");
    expect(files(w, "main")).not.toContain(`rfcs/active/${RENUMBERED}`);
  });

  it("renumbers a commit with other files in place and rebases it", async () => {
    const w = world();
    const result = await run(w, {
      choice: "main",
      noRow: true,
      extra: { "notes.txt": "n\n" },
      before: upstreamTakes,
    });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("succeeded");
    expect(files(w, "main")).toContain(`rfcs/active/${RENUMBERED}`);
    expect(show(w, "main", "notes.txt")).toBe("n\n");
    expect(above(w, "main~1", "main")).toEqual(["Add RFC-027 on ours"]);
    expect(existsSync(path.join(w.base, "wt-rfc", "rfcs/active", OURS))).toBe(
      false,
    );
  });

  it("stops at a rebase conflict in a commit with other files and pushes nothing", async () => {
    const w = world();
    const result = await run(w, {
      choice: "main",
      extra: { "notes.txt": "n\n" },
      before: upstreamTakes,
    });
    expect(result.status).toBe("failed");
    expect(files(w, "main")).not.toContain(`rfcs/active/${RENUMBERED}`);
    expect(above(w, "main~1", "main")).toEqual(["theirs"]);
  });
});
