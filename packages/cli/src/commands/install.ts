/**
 * @file This installation of Ork: its name and version for the root command;
 *   `ork doctor`, which prints Ork's version against the last update check and
 *   the environment checks (Node, git, the user's own claude, gh and aws
 *   logins, the project's links) and fails when no agent driver can run; and
 *   `ork upgrade`, which asks the npm registry for the latest version and, when
 *   it is newer, upgrades Ork the way it was installed after the user agrees
 *   (`--yes` skips the question; `--check` only reports). A clone or `npx` gets
 *   advice instead. Ork never upgrades itself unasked, and stores no
 *   credentials (ADR-038).
 */

import {
  fetchLatest,
  openStore,
  planUpgrade,
  readUpdateCache,
  registryOf,
  releaseNotes,
  runInstall,
  runningRunIds,
  runningScript,
  updateCachePath,
  writeUpdateCache,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { ORK_NAME, ORK_VERSION } from "../__build_info__.ts";
import {
  exec,
  experimentsCheck,
  orkCheck,
  runChecks,
  socketCheck,
  triggerChecks,
} from "../doctor/checks.ts";
import { formatCheck } from "../doctor/format.ts";
import { leaseChecks } from "../doctor/lease-checks.ts";
import { projectChecks } from "../doctor/project-checks.ts";
import { confirm, style, write, writeErr } from "../output.ts";
import { projectAt } from "../project/place.ts";

export { formatCheck };

/** The root command's name, version and description. */
export const ORK_META = {
  name: "ork",
  version: ORK_VERSION,
  description: "Orchestrate Claude agents on your machine",
};

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description:
      "Check Node, git, and your own claude, gh, and aws logins (Ork stores no credentials)",
  },
  run: async () => {
    const { results, ok } = await runChecks(
      exec,
      process.env,
      process.versions.node,
    );
    const place = projectAt(process.cwd());
    const experiments = experimentsCheck(place);
    for (const result of [
      orkCheck(),
      ...results,
      ...(place.mode === "attached" ? [] : projectChecks(place.root)),
      socketCheck(),
      ...triggerChecks(),
      ...(await leaseChecks(place)),
      experiments,
    ]) {
      for (const line of formatCheck(result)) write(line);
    }
    if (!ok) {
      write(
        `\n${style("red", "Not ready:")} Ork needs Node, git, and at least one agent driver.`,
      );
      process.exitCode = 1;
    }
    if (experiments.status === "fail") process.exitCode = 1;
  },
});

/** The ids of runs still running anywhere on this machine. */
const runningRuns = (): string[] => {
  const store = openStore();
  try {
    return runningRunIds(store).map(id => id.slice(0, 8));
  } finally {
    store.close();
  }
};

/** Records what the registry said, so the notice and doctor agree with it. */
const remember = (latest: string, notified: boolean): void => {
  try {
    const file = updateCachePath();
    const now = new Date().toISOString();
    writeUpdateCache(file, {
      ...readUpdateCache(file),
      checkedAt: now,
      latest,
      ...(notified ? { notified: { version: latest, at: now } } : {}),
    });
  } catch {
    // Only the cache; the upgrade itself is unaffected.
  }
};

/** Whether to go ahead: `--yes`, or the user says so on a terminal. */
const agreed = (yes: boolean, command: string): Promise<boolean> => {
  if (yes) return Promise.resolve(true);
  if (!process.stdin.isTTY) {
    write(`Run it yourself: ${command}\nor run ork upgrade --yes.`);
    return Promise.resolve(false);
  }
  return confirm(`Run ${command}?`);
};

export const upgrade = defineCommand({
  meta: {
    name: "upgrade",
    description:
      "Upgrade Ork to the latest version, the way it was installed (asks first)",
  },
  args: {
    check: {
      type: "boolean",
      description: "Only say whether a newer version is out",
      default: false,
    },
    yes: {
      type: "boolean",
      description: "Run the upgrade without asking",
      default: false,
    },
  },
  run: async ({ args }) => {
    const registry = registryOf(process.env);
    const latest = await fetchLatest(ORK_NAME, {
      ...(registry === undefined ? {} : { registry }),
      timeoutMs: 15_000,
      current: ORK_VERSION,
    });
    const plan = planUpgrade({
      name: ORK_NAME,
      current: ORK_VERSION,
      latest,
      script: runningScript(),
    });
    if (plan.kind === "unreachable") {
      writeErr("Could not reach the npm registry to look for a new version.");
      process.exitCode = 1;
      return;
    }
    if (latest !== null) remember(latest, plan.kind !== "latest");
    if (plan.kind === "latest") {
      write(`${style("green", "✓")} Ork ${ORK_VERSION} is the latest version.`);
      return;
    }
    write(
      `Ork ${style("bold", plan.latest)} is out (you have ${ORK_VERSION}).\nWhat changed: ${releaseNotes(ORK_NAME, plan.latest)}`,
    );
    if (args.check) return;
    if (plan.kind === "advice") {
      write(plan.text);
      process.exitCode = 1;
      return;
    }
    const running = runningRuns();
    if (running.length > 0) {
      write(
        `${style("yellow", "!")} Running now: ${running.join(", ")}. Their next sessions would start from the new install; upgrading after they finish is safer.`,
      );
    }
    const command = plan.argv.join(" ");
    write(`Installed with ${plan.installer.label}.`);
    if (!(await agreed(args.yes, command))) {
      process.exitCode = 1;
      return;
    }
    const code = await runInstall(plan.argv);
    if (code !== 0) {
      writeErr(`${command} failed (exit ${code}); the upgrade did not finish.`);
      process.exitCode = code;
      return;
    }
    write(`${style("green", "✓")} Upgraded Ork to ${plan.latest}.`);
  },
});
