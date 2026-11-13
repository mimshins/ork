/**
 * @file `kit.ts stop <root>` and `kit.ts sweep <dir>`: end what a QA tester
 *   left running, then remove the folders. `stop` (1) stops every live run in
 *   the root's store (`ork ps --json`, then `ork stop <id>`), (2) ends every
 *   process whose argv contains `<root>/` (the stand-ins are copies in
 *   `<root>/bin`, so what they start carries the root), SIGTERM and then
 *   SIGKILL after a short grace, and (3) removes the root. A process that
 *   rewrites its argv would escape step 2; none of Ork's do. The kit's own
 *   process and its ancestors (the tester's shell) are never ended. `sweep`
 *   does this for every kit root directly inside `<dir>` and removes `<dir>`.
 *   Both refuse any path that is not a kit root (or, for `sweep`, not a folder)
 *   under the temp folder (`roots.ts`).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { kitRoot, tmpPath } from "./roots.ts";
import { isKitRoot } from "./setup.ts";

/**
 * Runs `ork <args>` for a root's store and returns its stdout; throws on
 * failure.
 */
export type RunOrk = (root: string, args: readonly string[]) => string;

/** The real `ork`: the root's own install first, with the root's `HOME`. */
export const orkInRoot: RunOrk = (root, args) =>
  execFileSync("ork", [...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      HOME: path.join(root, "home"),
      PATH: [
        path.join(root, "bin"),
        path.join(root, "prefix", "node_modules", ".bin"),
        process.env["PATH"],
      ].join(path.delimiter),
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

/** Whether a row of `ork ps --json` is a running run. */
const isLive = (row: unknown): row is { id: string; status: string } =>
  typeof row === "object" &&
  row !== null &&
  "status" in row &&
  row.status === "running" &&
  "id" in row &&
  typeof row.id === "string";

/**
 * The ids of the root's live (`running`) runs; none when `ork` or the store is
 * missing.
 */
const liveRuns = (root: string, ork: RunOrk): string[] => {
  try {
    const rows: unknown = JSON.parse(
      ork(root, ["ps", "--json", "--project", "all", "--limit", "100000"]),
    );
    return Array.isArray(rows)
      ? rows.filter(row => isLive(row)).map(row => row.id)
      : [];
  } catch {
    return [];
  }
};

type Proc = { pid: number; ppid: number; zombie: boolean; command: string };

/** Every process, from `ps`. */
const listProcesses = (): Proc[] =>
  execFileSync("ps", ["-axwwo", "pid=,ppid=,stat=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .flatMap(line => {
      const found = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
      return found === null
        ? []
        : [
            {
              pid: Number(found[1]),
              ppid: Number(found[2]),
              zombie: (found[3] ?? "").startsWith("Z"),
              command: found[4] ?? "",
            },
          ];
    });

/** This process and its ancestors: never ended, however their argv reads. */
const ownLine = (procs: readonly Proc[]): Set<number> => {
  const parent = new Map(procs.map(proc => [proc.pid, proc.ppid]));
  const line = new Set<number>();
  let pid: number | undefined = process.pid;
  while (pid !== undefined && pid > 1 && !line.has(pid)) {
    line.add(pid);
    pid = parent.get(pid);
  }
  return line;
};

/** The live processes whose argv holds `<root>/` for any of `roots`. */
const carrying = (roots: readonly string[]): Proc[] => {
  const procs = listProcesses();
  const own = ownLine(procs);
  const needles = roots.map(root => `${root}${path.sep}`);
  return procs.filter(
    proc =>
      !proc.zombie &&
      !own.has(proc.pid) &&
      needles.some(needle => proc.command.includes(needle)),
  );
};

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const signal = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
};

/** Ends the processes carrying `<root>/`: SIGTERM, then SIGKILL after `graceMs`. */
const endProcesses = (roots: readonly string[], graceMs: number): void => {
  for (const proc of carrying(roots)) {
    signal(proc.pid, "SIGTERM");
  }
  for (
    let waited = 0;
    waited < graceMs && carrying(roots).length > 0;
    waited += 50
  ) {
    sleep(50);
  }
  for (const proc of carrying(roots)) {
    signal(proc.pid, "SIGKILL");
  }
};

/** How `stop` is run; `ork` and the grace are injectable for tests. */
export type StopOptions = { ork?: RunOrk; graceMs?: number };

/**
 * Stops a kit root's live runs, ends the processes that carry it, and removes
 * it.
 *
 * @throws When `root` is not a kit root under the temp folder.
 */
export const stopKit = (
  root: string,
  { ork = orkInRoot, graceMs = 2000 }: StopOptions = {},
): string => {
  const real = kitRoot(root);
  const ids = liveRuns(real, ork);
  for (const id of ids) {
    try {
      ork(real, ["stop", id]);
    } catch {
      // The run ended meanwhile, or `ork` is gone: the sweep below goes on.
    }
  }
  const names = [...new Set([real, path.resolve(root)])];
  endProcesses(names, graceMs);
  rmSync(real, { recursive: true, force: true });
  return `Stopped ${String(ids.length)} run(s), ended what carried ${real}/, removed it.`;
};

/**
 * `stopKit` for every kit root directly inside `dir`, then removes `dir`.
 *
 * @throws When `dir` is not a folder under the temp folder.
 */
export const sweepDir = (dir: string, options: StopOptions = {}): string => {
  const real = tmpPath(dir);
  const roots = isKitRoot(real)
    ? [real]
    : readdirSync(real, { withFileTypes: true }).flatMap(entry => {
        const child = path.join(real, entry.name);
        return entry.isDirectory() && isKitRoot(child) ? [child] : [];
      });
  // A pack folder holds the tarball even when no tester set up a root.
  if (
    roots.length === 0 &&
    !readdirSync(real).some(name => name.endsWith(".tgz"))
  ) {
    throw new Error(`${real} holds no kit root or tarball; not removing it.`);
  }
  const lines = roots.map(root => stopKit(root, options));
  rmSync(real, { recursive: true, force: true });
  return [...lines, `Removed ${real}.`].join("\n");
};
