/**
 * @file Tests for `ork __onboard finish`, in real git repositories with a
 *   worktree standing for the writer's: the scope check (committed and
 *   uncommitted paths), the caps, no `driver` or `model`, only Ork's agents,
 *   the canonical rewrite committed in the worktree (hooks running), validation
 *   under each ready driver, the "needs your eye" list against `HEAD`, and a
 *   link in the worktree not followed.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DriverCheck } from "@krapht/ork-integrations";
import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { finish, finishText } from "../src/onboard/verbs-finish.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const PATH_NOW = process.env["PATH"] ?? "";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const tempDir = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-finish-")));

const put = (root: string, files: Record<string, string>): void => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
};

const workflow = (name: string, extra = "", node = ""): string =>
  `schemaVersion: 1
name: ${name}
limits:
  budgetUsd: 2
  budgetTokens: 400000
${extra}nodes:
  build:
    type: agent.worker
    agent: ork-implementer
    prompt: Build it.
${node}`;

/** `text` as the serializer writes it. */
const canonical = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return serializeWorkflow(parsed.workflow);
};

const BASE = canonical(workflow("base"));

const ready =
  (...ids: DriverCheck["id"][]) =>
  (): Promise<DriverCheck[]> =>
    Promise.resolve(
      ids.map(id => ({
        id,
        result: { name: id, status: "ok" as const, detail: "ready" },
      })),
    );

type Scenario = {
  root: string;
  worktree: string;
  branch: string;
};

/** A repository with a base workflow, and a worktree on a branch off it. */
const scenario = (head: Record<string, string> = {}): Scenario => {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  put(root, {
    "README.md": "x\n",
    ".ork/workflows/base.ork.yaml": BASE,
    ...head,
  });
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  const worktree = path.join(tempDir(), "wt");
  git(root, "worktree", "add", "-q", "-b", "ork/w", worktree);
  return { root, worktree, branch: "ork/w" };
};

const check = (scene: Scenario, ids: DriverCheck["id"][] = ["claude-code"]) =>
  finish({
    root: scene.root,
    worktree: scene.worktree,
    branch: scene.branch,
    run: "r1",
    checks: ready(...ids),
  });

/** The problems of a writer who changed `files` (uncommitted). */
const problemsOf = async (
  files: Record<string, string>,
  head: Record<string, string> = {},
): Promise<string[]> => {
  const scene = scenario(head);
  put(scene.worktree, files);
  return (await check(scene)).problems;
};

describe("finish: scope", () => {
  it("passes a new workflow and rewrites it canonically, committed", async () => {
    const scene = scenario();
    // Not canonical: a comment and a different key order.
    const draft = `# mine\n${workflow("ci").replace("schemaVersion: 1\nname: ci\n", "name: ci\nschemaVersion: 1\n")}`;
    put(scene.worktree, { ".ork/workflows/ci.ork.yaml": draft });
    const report = await check(scene);
    expect(report).toEqual({ problems: [], eye: [] });
    const text = readFileSync(
      path.join(scene.worktree, ".ork/workflows/ci.ork.yaml"),
      "utf8",
    );
    expect(text).toBe(canonical(draft));
    expect(git(scene.worktree, "log", "-1", "--format=%s")).toBe(
      "ork: canonical form (run r1)",
    );
    expect(git(scene.worktree, "status", "--porcelain")).toBe("");
  });

  it("sees what the writer committed on its branch too", async () => {
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci")),
      "src/evil.ts": "x\n",
    });
    git(scene.worktree, "add", ".");
    git(scene.worktree, "commit", "-q", "-m", "writer");
    expect((await check(scene)).problems).toEqual([
      "src/evil.ts: outside .ork/workflows/*.ork.yaml and .ork/project.yaml",
    ]);
  });

  it("makes no commit when the files are already canonical", async () => {
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci")),
    });
    await check(scene);
    expect(git(scene.worktree, "log", "-1", "--format=%s")).toBe("first");
  });

  it("refuses every other path, a nested workflow, a deletion and a rename", async () => {
    const scene = scenario();
    put(scene.worktree, {
      "src/a.ts": "x\n",
      ".github/workflows/ci.yml": "x\n",
      ".ork/workflows/sub/n.ork.yaml": canonical(workflow("n")),
      ".ork/agents/mine.md": "x\n",
      ".ork/workflows/ok.ork.yaml": canonical(workflow("ok")),
    });
    git(scene.worktree, "rm", "-q", ".ork/workflows/base.ork.yaml");
    const problems = (await check(scene)).problems;
    const outside = "outside .ork/workflows/*.ork.yaml and .ork/project.yaml";
    expect(problems.toSorted()).toEqual([
      `.github/workflows/ci.yml: ${outside}`,
      ".ork/agents/mine.md: " + outside,
      ".ork/workflows/base.ork.yaml: deleted",
      `.ork/workflows/sub/n.ork.yaml: ${outside}`,
      `src/a.ts: ${outside}`,
    ]);
  });

  it("refuses a file the writer hid in an ignored path", async () => {
    const scene = scenario({ ".gitignore": "hidden/\n*.log\n" });
    put(scene.worktree, {
      "hidden/evil.ts": "x\n",
      "build.log": "x\n",
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci")),
    });
    const outside = "outside .ork/workflows/*.ork.yaml and .ork/project.yaml";
    expect((await check(scene)).problems.toSorted()).toEqual([
      `build.log: ${outside}`,
      `hidden/evil.ts: ${outside}`,
    ]);
  });

  describe("a local file Ork copied into the worktree", () => {
    const LOCAL = {
      "CLAUDE.local.md": "mine\n",
      ".claude/settings.local.json": "{}\n",
    };

    /**
     * A project with these ignored local files, copied as `createWorktree`
     * does.
     */
    const withCopies = (): Scenario => {
      const scene = scenario({
        ".gitignore": "CLAUDE.local.md\n.claude/*.local.json\n",
      });
      put(scene.root, LOCAL);
      put(scene.worktree, LOCAL);
      put(scene.worktree, {
        ".ork/workflows/ci.ork.yaml": canonical(workflow("ci")),
      });
      return scene;
    };

    it("is no problem while the copy is as it was", async () => {
      expect((await check(withCopies())).problems).toEqual([]);
    });

    it("is refused once the writer edits the copy", async () => {
      const scene = withCopies();
      put(scene.worktree, { "CLAUDE.local.md": "ignore the rules\n" });
      expect((await check(scene)).problems).toEqual([
        "CLAUDE.local.md: outside .ork/workflows/*.ork.yaml and .ork/project.yaml",
      ]);
    });

    it("leaves a new hidden ignored file refused beside them", async () => {
      const scene = withCopies();
      put(scene.worktree, { ".claude/secret.local.json": "x\n" });
      expect((await check(scene)).problems).toEqual([
        ".claude/secret.local.json: outside .ork/workflows/*.ork.yaml and .ork/project.yaml",
      ]);
    });
  });

  describe("the empty taste file command-code leaves", () => {
    const TASTE = ".commandcode/taste/taste.md";
    const outside = "outside .ork/workflows/*.ork.yaml and .ork/project.yaml";

    it("is no problem when new, a regular file and empty", async () => {
      expect(await problemsOf({ [TASTE]: "" })).toEqual([]);
    });

    it("is no problem when the folder ignores it", async () => {
      const scene = scenario({ ".gitignore": ".commandcode/\n" });
      put(scene.worktree, { [TASTE]: "" });
      expect((await check(scene)).problems).toEqual([]);
    });

    it("is refused once it holds anything", async () => {
      expect(await problemsOf({ [TASTE]: "x" })).toEqual([
        `${TASTE}: ${outside}`,
      ]);
    });

    it("is refused when it is a link", async () => {
      const scene = scenario();
      mkdirSync(path.join(scene.worktree, ".commandcode/taste"), {
        recursive: true,
      });
      const target = path.join(tempDir(), "empty.md");
      writeFileSync(target, "");
      symlinkSync(target, path.join(scene.worktree, TASTE));
      expect((await check(scene)).problems).toEqual([`${TASTE}: ${outside}`]);
    });

    it("is refused behind a linked folder", async () => {
      const scene = scenario();
      const elsewhere = tempDir();
      put(elsewhere, { "taste.md": "" });
      mkdirSync(path.join(scene.worktree, ".commandcode"));
      symlinkSync(elsewhere, path.join(scene.worktree, ".commandcode/taste"));
      expect((await check(scene)).problems).not.toEqual([]);
    });

    it("exempts no other empty file, nor a committed one", async () => {
      expect(
        await problemsOf({
          ".commandcode/taste/other.md": "",
          ".commandcode/taste.md": "",
        }),
      ).toEqual([
        `.commandcode/taste.md: ${outside}`,
        `.commandcode/taste/other.md: ${outside}`,
      ]);
      const scene = scenario();
      put(scene.worktree, { [TASTE]: "" });
      git(scene.worktree, "add", "-f", TASTE);
      git(scene.worktree, "commit", "-q", "-m", "taste");
      expect((await check(scene)).problems).toEqual([`${TASTE}: ${outside}`]);
    });
  });

  it("refuses a workflow that is a link, and does not follow it", async () => {
    const scene = scenario();
    const secret = path.join(tempDir(), "secret.ork.yaml");
    writeFileSync(secret, canonical(workflow("secret")));
    mkdirSync(path.join(scene.worktree, ".ork/workflows"), { recursive: true });
    symlinkSync(secret, path.join(scene.worktree, ".ork/workflows/x.ork.yaml"));
    expect((await check(scene)).problems).toEqual([
      ".ork/workflows/x.ork.yaml: is a link, or behind one",
    ]);
    expect(readFileSync(secret, "utf8")).toBe(canonical(workflow("secret")));
  });
});

describe("finish: each workflow", () => {
  it("needs both caps", async () => {
    const text = workflow("ci").replace(
      "limits:\n  budgetUsd: 2\n  budgetTokens: 400000\n",
      "limits:\n  concurrency: 1\n",
    );
    expect(await problemsOf({ ".ork/workflows/ci.ork.yaml": text })).toEqual([
      ".ork/workflows/ci.ork.yaml: limits.budgetUsd is missing",
      ".ork/workflows/ci.ork.yaml: limits.budgetTokens is missing",
    ]);
  });

  it("names no driver or model, in defaults or on a node", async () => {
    const text = workflow(
      "ci",
      "defaults:\n  model: claude-code.sonnet\n",
      "    driver: open-code\n",
    );
    const problems = await problemsOf({ ".ork/workflows/ci.ork.yaml": text });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("defaults sets `model`"),
        expect.stringContaining("node build sets `driver`"),
      ]),
    );
  });

  it("uses only ork-implementer and ork-reviewer, and defines no agents", async () => {
    const text = workflow(
      "ci",
      "agents:\n  mine:\n    instructions: be me\n",
    ).replace("agent: ork-implementer", "agent: mine");
    const problems = await problemsOf({ ".ork/workflows/ci.ork.yaml": text });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("defines agents of its own (mine)"),
        expect.stringContaining("node build uses agent `mine`"),
      ]),
    );
  });

  it("reports a file that does not parse, and leaves it alone", async () => {
    const scene = scenario();
    put(scene.worktree, { ".ork/workflows/bad.ork.yaml": "name: Bad Name\n" });
    const { problems } = await check(scene);
    expect(problems.length).toBeGreaterThan(0);
    expect(
      problems.every(p => p.startsWith(".ork/workflows/bad.ork.yaml:")),
    ).toBe(true);
    expect(
      readFileSync(
        path.join(scene.worktree, ".ork/workflows/bad.ork.yaml"),
        "utf8",
      ),
    ).toBe("name: Bad Name\n");
  });

  it("fails what ork validate fails", async () => {
    const text = `${workflow("ci")}edges:\n  - build -> nowhere\n`;
    const problems = await problemsOf({ ".ork/workflows/ci.ork.yaml": text });
    expect(problems).toEqual([
      expect.stringMatching(/^\.ork\/workflows\/ci\.ork\.yaml: \S+ /u),
    ]);
  });

  it("fails a node a ready driver refuses, once", async () => {
    // Command Code does not load a node's own MCP servers.
    const node = "    mcp:\n      - docs\n";
    const scene = scenario({
      ".mcp.json": '{"mcpServers":{"docs":{"command":"docs-server"}}}\n',
    });
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci", "", node),
    });
    const refused = await check(scene, ["claude-code", "command-code"]);
    const alone = await check(scene, ["claude-code"]);
    expect(alone.problems).toEqual([]);
    expect(refused.problems).toEqual([
      expect.stringContaining(".ork/workflows/ci.ork.yaml: driver.unfit"),
    ]);
  });
});

const heavyAt = (value: string): string =>
  `schemaVersion: 1\nheavy:\n  - ${value}\n`;

describe("finish: needs your eye", () => {
  it("lists each new allow rule, env entry and network reach", async () => {
    const node = `    tools:
      allow:
        - Bash(pnpm test:*)
        - WebFetch
    before:
      script: echo hi
      env:
        TOKEN: "{{env.TOKEN}}"
  issues:
    type: tool.gh
    command: issue list
  run:
    type: tool.shell
    command: ./scripts/check.sh
    env:
      CI_TOKEN: "{{env.CI_TOKEN}}"
`;
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci", "", node),
      ".ork/project.yaml":
        "schemaVersion: 1\npermissions:\n  allow:\n    - Bash(git log:*)\n",
    });
    const { eye } = await check(scene);
    expect(eye.toSorted()).toEqual(
      [
        ".ork/project.yaml: project rules allows `Bash(git log:*)`",
        ".ork/workflows/ci.ork.yaml: node build allows `Bash(pnpm test:*)`",
        ".ork/workflows/ci.ork.yaml: node build allows `WebFetch` (network)",
        ".ork/workflows/ci.ork.yaml: node build before sets env `TOKEN`",
        ".ork/workflows/ci.ork.yaml: node issues is a tool.gh node (network)",
        ".ork/workflows/ci.ork.yaml: node run sets env `CI_TOKEN`",
      ].toSorted(),
    );
  });

  it("drops a plain read tool and lists every other name", async () => {
    const node = `    tools:
      allow:
        - Read
        - Glob
        - Grep
        - LS
        - NotebookRead
        - Read(src/**)
        - Bash(cat:*)
        - Edit
        - "???"
`;
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci", "", node),
      ".ork/project.yaml":
        "schemaVersion: 1\npermissions:\n  allow:\n    - Read\n    - Write\n",
    });
    expect((await check(scene)).eye.toSorted()).toEqual(
      [
        ".ork/project.yaml: project rules allows `Write`",
        ".ork/workflows/ci.ork.yaml: node build allows `Bash(cat:*)`",
        ".ork/workflows/ci.ork.yaml: node build allows `Edit`",
        ".ork/workflows/ci.ork.yaml: node build allows `???`",
      ].toSorted(),
    );
  });

  it("lists a node's context, isolation and tools.only", async () => {
    const node = `    context:
      - docs/extra.md
    isolation: shared
    tools:
      only:
        - Read
        - Bash
`;
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci", "", node),
    });
    expect((await check(scene)).eye.toSorted()).toEqual([
      '.ork/workflows/ci.ork.yaml: node build changes `context` to `["docs/extra.md"]`',
      '.ork/workflows/ci.ork.yaml: node build changes `isolation` to `"shared"`',
      '.ork/workflows/ci.ork.yaml: node build changes `tools.only` to `["Read","Bash"]`',
    ]);
  });

  it("lists a workflow's context, rules.git, rules.links and isolation default", async () => {
    const extra = `layers:
  context:
    - docs/x.md
rules:
  git:
    commit: never
  links: "off"
defaults:
  isolation: shared
`;
    const scene = scenario();
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci", extra),
    });
    expect((await check(scene)).eye.toSorted()).toEqual([
      '.ork/workflows/ci.ork.yaml: workflow changes `context` to `["docs/x.md"]`',
      '.ork/workflows/ci.ork.yaml: workflow changes `defaults.isolation` to `"shared"`',
      '.ork/workflows/ci.ork.yaml: workflow changes `rules.git` to `{"commit":"never"}`',
      '.ork/workflows/ci.ork.yaml: workflow changes `rules.links` to `"off"`',
    ]);
  });

  it("lists the project's context, heavy, calls, follow-ups file, git, links and isolation", async () => {
    const scene = scenario();
    put(scene.worktree, {
      ".ork/project.yaml": `schemaVersion: 1
context:
  - docs/c.md
heavy:
  - pnpm check
calls:
  accept:
    - other
followUps:
  store: file
  file: notes.md
git:
  commit: never
links: "off"
defaults:
  isolation: shared
`,
    });
    expect((await check(scene)).eye.toSorted()).toEqual(
      [
        '.ork/project.yaml: project changes `context` to `["docs/c.md"]`',
        '.ork/project.yaml: project changes `heavy` to `["pnpm check"]`',
        '.ork/project.yaml: project changes `calls.accept` to `["other"]`',
        '.ork/project.yaml: project changes `followUps.file` to `"notes.md"`',
        '.ork/project.yaml: project changes `rules.git` to `{"commit":"never"}`',
        '.ork/project.yaml: project changes `rules.links` to `"off"`',
        '.ork/project.yaml: project changes `defaults.isolation` to `"shared"`',
      ].toSorted(),
    );
  });

  it("lists such a field again only when its value differs from HEAD", async () => {
    const same = scenario({ ".ork/project.yaml": heavyAt("pnpm check") });
    put(same.worktree, { ".ork/project.yaml": heavyAt("pnpm check") });
    expect((await check(same)).eye).toEqual([]);
    const changed = scenario({ ".ork/project.yaml": heavyAt("pnpm check") });
    put(changed.worktree, { ".ork/project.yaml": heavyAt("pnpm test") });
    expect((await check(changed)).eye).toEqual([
      '.ork/project.yaml: project changes `heavy` to `["pnpm test"]`',
    ]);
  });

  it("lists a field that HEAD set and the writer removed", async () => {
    const node =
      "    isolation: readonly\n    tools:\n      only:\n        - Read\n";
    const scene = scenario({
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci", "", node)),
      ".ork/project.yaml": heavyAt("pnpm check"),
    });
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": workflow("ci"),
      ".ork/project.yaml": "schemaVersion: 1\n",
    });
    expect((await check(scene)).eye.toSorted()).toEqual([
      ".ork/project.yaml: project removes `heavy`",
      ".ork/workflows/ci.ork.yaml: node build removes `isolation`",
      ".ork/workflows/ci.ork.yaml: node build removes `tools.only`",
    ]);
  });

  it("lists a deleted node once, not once per field it had", async () => {
    const extra = `  extra:
    type: agent.worker
    agent: ork-implementer
    prompt: Check it.
    isolation: readonly
    tools:
      only:
        - Read
`;
    const scene = scenario({
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci", "", extra)),
    });
    put(scene.worktree, { ".ork/workflows/ci.ork.yaml": workflow("ci") });
    expect((await check(scene)).eye).toEqual([
      ".ork/workflows/ci.ork.yaml: node extra removed",
    ]);
  });

  it("does not list a removed allow rule or env entry (it narrows rights)", async () => {
    const node = `    tools:
      allow:
        - Bash(pnpm test:*)
    before:
      script: echo hi
      env:
        TOKEN: "{{env.TOKEN}}"
`;
    const scene = scenario({
      ".ork/workflows/ci.ork.yaml": canonical(workflow("ci", "", node)),
    });
    put(scene.worktree, { ".ork/workflows/ci.ork.yaml": workflow("ci") });
    expect((await check(scene)).eye).toEqual([]);
  });

  it("lists a project-wide default driver and model", async () => {
    const scene = scenario();
    put(scene.worktree, {
      ".ork/project.yaml":
        "schemaVersion: 1\ndefaults:\n  driver: claude-code\n  model: opus\n",
    });
    const { eye } = await check(scene);
    expect(eye.toSorted()).toEqual([
      ".ork/project.yaml: project defaults set `driver` for every workflow",
      ".ork/project.yaml: project defaults set `model` for every workflow",
    ]);
  });

  it("lists only what is new against HEAD", async () => {
    const allowed = workflow(
      "base",
      "",
      "    tools:\n      allow:\n        - Bash(pnpm test:*)\n",
    );
    const scene = scenario({
      ".ork/workflows/base.ork.yaml": canonical(allowed),
    });
    put(scene.worktree, {
      ".ork/workflows/base.ork.yaml": allowed.replace(
        "- Bash(pnpm test:*)",
        "- Bash(pnpm test:*)\n        - Bash(pnpm lint:*)",
      ),
    });
    expect((await check(scene)).eye).toEqual([
      ".ork/workflows/base.ork.yaml: node build allows `Bash(pnpm lint:*)`",
    ]);
  });
});

describe("finish: the canonical commit", () => {
  it("is a problem when the repository's hook refuses it", async () => {
    const scene = scenario();
    const hook = path.join(scene.root, ".git/hooks/pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'no commits today' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": `# mine\n${workflow("ci")}`,
    });
    expect((await check(scene)).problems).toEqual([
      expect.stringContaining("canonical commit refused"),
    ]);
  });

  it("is a problem naming the file when a hook rewrites it", async () => {
    const scene = scenario();
    const hook = path.join(scene.root, ".git/hooks/pre-commit");
    writeFileSync(
      hook,
      "#!/bin/sh\necho '# hook' >> .ork/workflows/ci.ork.yaml\n",
    );
    chmodSync(hook, 0o755);
    put(scene.worktree, {
      ".ork/workflows/ci.ork.yaml": `# mine\n${workflow("ci")}`,
    });
    expect((await check(scene)).problems).toEqual([
      ".ork/workflows/ci.ork.yaml: rewritten by a commit hook, no longer canonical",
    ]);
    // The hook ran: the commit exists, none was skipped.
    expect(git(scene.worktree, "log", "-1", "--format=%s")).toBe(
      "ork: canonical form (run r1)",
    );
  });
});

describe("finishText and the program", () => {
  it("prints two sections, `- none` for an empty one", () => {
    expect(finishText({ problems: [], eye: [] })).toBe(
      "problems:\n- none\nneeds your eye:\n- none\n",
    );
    expect(finishText({ problems: ["a:\nb"], eye: ["c"] })).toBe(
      "problems:\n- a: b\nneeds your eye:\n- c\n",
    );
  });

  it("exits 2 with one stderr line when a flag is missing", () => {
    const out = spawnSync(
      process.execPath,
      [BIN, "__onboard", "finish", "--worktree", "x"],
      { encoding: "utf8", env: { PATH: PATH_NOW } },
    );
    expect(out.status).toBe(2);
    expect(out.stderr.trim().split("\n")).toHaveLength(1);
  });
});
