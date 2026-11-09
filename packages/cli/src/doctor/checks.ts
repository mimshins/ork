/**
 * @file The checks behind `ork doctor`: Ork's own version against the last
 *   update check, each tool's presence and login status (the drivers' own
 *   checks, which `ork run` also reads to pick the one ready), and whether a
 *   run's socket path fits, and which experiments are on, through an injectable
 *   `exec` so tests need no real tools. Never prints a token or an account.
 */

import { execFile } from "node:child_process";

import {
  type Experiment,
  EXPERIMENTS,
  type ExperimentSource,
  experimentsOn,
  knownExperiments,
  lateTriggers,
  loadProject,
  openStore,
  placeFiles,
  type ProjectPlace,
  readUpdateCache,
  socketRoom,
  storePath,
  triggersReport,
  updateCachePath,
} from "@krapht/ork-core";
import {
  type CheckResult,
  driverChecks,
  type Env,
  type Exec,
  firstLine,
  INTEGRATIONS,
} from "@krapht/ork-integrations";

import { ORK_VERSION } from "../__build_info__.ts";
import { updateCheckOff } from "../update/notify.ts";
import { versionCheck } from "../update/upgrade.ts";

const TIMEOUT_MS = 15_000;

export const exec: Exec = (program, args) =>
  new Promise(resolve => {
    execFile(
      program,
      args,
      { timeout: TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        resolve({ ok: error === null, stdout });
      },
    );
  });

/** Ork's own version, against the last update check (no network). */
export const orkCheck = (): CheckResult =>
  versionCheck(
    ORK_VERSION,
    readUpdateCache(updateCachePath()),
    updateCheckOff(process.env, [], process.stderr.isTTY),
  );

export const MIN_NODE = [24, 20] as const;

export const checkNode = (version: string): CheckResult => {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [minMajor, minMinor] = MIN_NODE;
  const ok = major > minMajor || (major === minMajor && minor >= minMinor);
  return ok
    ? { name: "node", status: "ok", detail: `v${version}` }
    : {
        name: "node",
        status: "fail",
        detail: `v${version}`,
        hint: `Ork needs Node ${MIN_NODE.join(".")} or later.`,
      };
};

/** A work tree with no commit has no `HEAD` for a worktree to branch from. */
export const checkHead = async (run: Exec): Promise<CheckResult> => {
  const head = await run("git", ["rev-parse", "--verify", "HEAD"]);
  return head.ok
    ? { name: "git commits", status: "ok", detail: "HEAD exists" }
    : {
        name: "git commits",
        status: "warn",
        detail: "no commit yet",
        hint: "Make a first commit: worktree runs branch from HEAD.",
      };
};

export const checkGit = async (run: Exec): Promise<CheckResult[]> => {
  const version = await run("git", ["--version"]);
  if (!version.ok) {
    return [
      {
        name: "git",
        status: "fail",
        detail: "not found",
        hint: "Install git; Ork gives each writing node its own worktree.",
      },
    ];
  }
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"]);
  const head = inside.ok ? await checkHead(run) : null;
  return [
    { name: "git", status: "ok", detail: firstLine(version.stdout) },
    inside.ok
      ? { name: "git repo", status: "ok", detail: "inside a work tree" }
      : {
          name: "git repo",
          status: "warn",
          detail: "not a git repository",
          hint: "Run Ork inside a git repository so nodes can use worktrees.",
        },
    ...(head === null ? [] : [head]),
  ];
};

/** What `ork init` warns of: a work tree with no commit, else null. */
export const headWarning = async (run: Exec): Promise<string | null> => {
  const head = (await checkGit(run)).find(r => r.name === "git commits");
  return head?.status === "warn"
    ? `${head.detail}. ${head.hint ?? ""}`.trim()
    : null;
};

/**
 * Runs every check: Node and git, then every registered Claude driver and
 * integration (ADR-022). Node, git, and at least one driver are required;
 * integrations are optional.
 */
export const runChecks = async (
  run: Exec,
  env: Env,
  nodeVersion: string,
): Promise<{ results: CheckResult[]; ok: boolean }> => {
  const [git, checked, tools] = await Promise.all([
    checkGit(run),
    driverChecks(run, env),
    Promise.all(
      INTEGRATIONS.flatMap(i =>
        i.doctor === undefined ? [] : [i.doctor(run, env)],
      ),
    ),
  ]);
  const drivers = checked.map(({ result }) => result);
  const results = [checkNode(nodeVersion), ...git, ...drivers, ...tools];
  const anyDriver = drivers.some(d => d.status === "ok");
  const ok = anyDriver && !results.some(r => r.status === "fail");
  return { results, ok };
};

/**
 * Whether a run's socket fits under `~` (L38). Past the limit a run can't
 * listen, and nothing else says so: answers, commands and followers fall back
 * to the store, a second at a time. `home` is the user's `~`.
 */
export const socketCheck = (
  home?: string,
  platform?: NodeJS.Platform,
): CheckResult => {
  const { bytes, max } = socketRoom(home, platform);
  if (max === undefined || bytes <= max) {
    return {
      name: "sockets",
      status: "ok",
      detail:
        max === undefined
          ? "not Unix sockets here"
          : `${String(bytes)} of ${String(max)} bytes`,
    };
  }
  return {
    name: "sockets",
    status: "warn",
    detail: `a run's socket path is ${String(bytes)} bytes, past the ${String(max)} this system allows`,
    hint: "Runs still work, but answers, commands and `ork logs --follow` wait up to a second for each, as they read the store instead. A shorter home folder path fixes it.",
  };
};

/**
 * What it says of triggers (RFC-011): a long-lived process can die quietly, so
 * a live trigger that hasn't looked when it should have is worth saying. `home`
 * is the user's `~` (tests pass a folder).
 */
export const triggerChecks = (home?: string): CheckResult[] => {
  const store = openStore(storePath(home));
  try {
    const report = triggersReport(store, store.projects(), home);
    const broken: CheckResult[] = report.broken.map(({ file, message }) => ({
      name: "triggers",
      status: "warn",
      detail: `${file}: ${message}`,
      hint: "Its triggers are off until it can be read.",
    }));
    const live = report.triggers.filter(({ standing }) => standing === "live");
    if (live.length === 0) return broken;
    const late = lateTriggers(report, new Date());
    if (late.length === 0) {
      return [
        ...broken,
        {
          name: "ork watch",
          status: "ok",
          detail: `${String(live.length)} trigger(s) looking`,
        },
      ];
    }
    return [
      ...broken,
      {
        name: "ork watch",
        status: "warn",
        detail: `not looking: ${late.map(({ trigger }) => trigger).join(", ")}`,
        hint:
          report.pid === undefined
            ? "Start it with `ork watch --detach`."
            : "See `ork watch --status`.",
      },
    ];
  } finally {
    store.close();
  }
};

const SOURCE_NAMES: Record<ExperimentSource, string> = {
  project: "project file",
  environment: "environment",
};

/**
 * Which experiments are on and who turned them on; an unknown name fails this
 * check alone. Prints names only. Outside a project, only the environment
 * counts.
 */
export const experimentsCheck = (
  place: ProjectPlace,
  env: Env = process.env,
  registry: readonly Experiment[] = EXPERIMENTS,
): CheckResult => {
  const { project, where } = loadProject(place.root, placeFiles(place).rules);
  const state = experimentsOn({ env, project, where, registry });
  if (!state.ok) {
    return {
      name: "experiments",
      status: "fail",
      detail: `unknown: ${state.unknown.map(u => `\`${u.name}\` (${u.where})`).join(", ")}`,
      hint: `Fix or remove the name. Known experiments: ${knownExperiments(registry)}.`,
    };
  }
  return {
    name: "experiments",
    status: "ok",
    detail:
      state.on.length === 0
        ? "none on"
        : state.on
            .map(
              ({ name, sources }) =>
                `${name} (${sources.map(s => SOURCE_NAMES[s]).join(" and ")})`,
            )
            .join(", "),
  };
};
