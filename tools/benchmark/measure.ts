/**
 * @file `pnpm benchmark <run> <folder>`: measures one Ork run and every run it
 *   called, for `.ai/skills/benchmark-run/`, into `<folder>/<name>/`:
 *   `summary.json` and `usage.csv` (summary.ts), `brief.md` (the run's inputs),
 *   `spec.md` (the plan or spec that was built) and `workflow/` (the workflows,
 *   `project.yaml` and agents at the commit the run started from). It reads a
 *   consistent copy of `~/.ork/state.db`, never the live store, and refuses a
 *   run still going. Options: `--name`, `--commits <sha,…>` (else the commits
 *   its tool nodes printed), `--db`, `--repo`.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { expandHome, rec, text } from "./json.ts";
import { agentsOf, resultCommits, summarize, usageCsv } from "./summary.ts";
import { loadTree, type Tree } from "./tree.ts";

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

/** A file at a commit, or null when it was not there. */
const fileAt = (repo: string, commit: string, file: string): string | null => {
  try {
    return git(repo, "show", `${commit}:${file}`);
  } catch {
    return null;
  }
};

const inputsOf = (tree: Tree, run: string) =>
  rec(
    tree.events.find(e => e.type === "run.started" && e.run === run)?.data[
      "inputs"
    ],
  );

/** Writes `brief.md`, `spec.md` and `workflow/`; returns the commit used. */
const writeInputs = (tree: Tree, repo: string, dir: string): string => {
  const root = tree.runs[0];
  const commit = git(
    repo,
    "rev-list",
    "-1",
    `--before=${root?.startedAt ?? ""}`,
    "main",
  ).trim();
  const brief = Object.entries(inputsOf(tree, root?.id ?? ""))
    .map(([k, v]) => `## ${k}\n\n${text(v) ?? JSON.stringify(v)}\n`)
    .join("\n");
  writeFileSync(path.join(dir, "brief.md"), brief);
  // What was built: a called run's `plan` input, else a node's `spec` output.
  const built =
    tree.runs.map(r => text(inputsOf(tree, r.id)["plan"])).find(Boolean) ??
    tree.events.map(e => text(rec(e.data["output"])["spec"])).find(Boolean);
  if (built !== undefined) writeFileSync(path.join(dir, "spec.md"), built);
  const workflow = path.join(dir, "workflow");
  mkdirSync(path.join(workflow, "agents"), { recursive: true });
  const files = [
    ...new Set(tree.runs.map(r => path.relative(repo, r.file))),
    ".ork/project.yaml",
  ];
  for (const file of files) {
    const body = fileAt(repo, commit, file);
    if (body !== null) {
      writeFileSync(path.join(workflow, path.basename(file)), body);
    }
  }
  for (const agent of agentsOf(tree.events)) {
    const where = text(agent["where"]) ?? "";
    const body = fileAt(repo, commit, where);
    if (body !== null) {
      writeFileSync(path.join(workflow, "agents", path.basename(where)), body);
    }
  }
  return commit;
};

/** A consistent copy of the live store, in a folder of its own. */
const copyStore = async (from: string): Promise<string> => {
  const to = path.join(mkdtempSync(path.join(tmpdir(), "ork-bench-")), "s.db");
  const live = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(live, to);
  } catch {
    copyFileSync(from, to);
  } finally {
    live.close();
  }
  return to;
};

const USAGE =
  "Usage: pnpm benchmark <run> <folder> [--name <name>] [--commits <sha,…>] [--db <state.db>] [--repo <path>]";

/** Measures the tree into its folder; returns why not, or null. */
const benchmark = (
  tree: Tree,
  folder: string,
  options: { name?: string; commits?: string; repo: string },
): string | null => {
  const root = tree.runs[0];
  if (root === undefined) return "No run.";
  if (root.status === "running") {
    return `Run ${root.id} is still running; benchmark it once it ends.`;
  }
  const dir = path.resolve(
    expandHome(folder, homedir()),
    options.name ?? root.id,
  );
  if (existsSync(path.join(dir, "summary.json"))) {
    return `${dir} already holds a benchmark; pick another --name.`;
  }
  mkdirSync(dir, { recursive: true });
  const workflowCommit = writeInputs(tree, options.repo, dir);
  const summary = Object.assign(
    { benchmark: path.basename(dir) },
    summarize(tree),
    {
      workflow_commit: workflowCommit,
      result_commits:
        options.commits?.split(",").filter(Boolean) ??
        resultCommits(tree.events),
    },
  );
  writeFileSync(
    path.join(dir, "summary.json"),
    `${JSON.stringify(summary, undefined, 2)}\n`,
  );
  writeFileSync(path.join(dir, "usage.csv"), usageCsv(tree.usage));
  console.log(dir);
  console.log(
    JSON.stringify(
      {
        cost_usd: summary.cost_usd,
        minutes: summary.minutes,
        sessions: summary.sessions,
        failed_sessions: summary.failed_sessions,
        permission_requests: summary.permission_requests,
        result_commits: summary.result_commits,
      },
      undefined,
      2,
    ),
  );
  return null;
};

const run = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      commits: { type: "string" },
      db: { type: "string" },
      repo: { type: "string" },
    },
  });
  const [id, folder] = positionals;
  if (id === undefined || folder === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const copy = await copyStore(
    values.db ?? path.join(homedir(), ".ork", "state.db"),
  );
  try {
    const db = new DatabaseSync(copy, { readOnly: true });
    const tree = loadTree(db, id);
    db.close();
    const problem = benchmark(tree, folder, {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.commits === undefined ? {} : { commits: values.commits }),
      repo: values.repo ?? process.cwd(),
    });
    if (problem !== null) {
      console.error(problem);
      process.exitCode = 1;
    }
  } finally {
    rmSync(path.dirname(copy), { recursive: true, force: true });
  }
};

if (import.meta.main) await run();
