/**
 * @file The free steps of `ork onboard` that come before any question: the
 *   refusals, the driver, `ork init`'s file steps when `.ork/` is missing, the
 *   uncommitted files the writer's worktree will lack, and the overview
 *   (specs/cli/onboard-flow.md). Nothing here starts a session or spends.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { placeFor, type ProjectPlace } from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import { style } from "../output.ts";
import { initRecorded } from "../project/init.ts";
import { pickDriver } from "./driver.ts";
import type { OnboardOptions } from "./options.ts";
import { type Overview, overview } from "./overview.ts";
import { refusal } from "./refusals.ts";

export type Prepared =
  | ({
      kind: "ready";
      place: ProjectPlace;
      driver: Driver;
      /** `ork init` changed `.gitignore`, which the branch does not hold. */
      gitignored: boolean;
      /**
       * The files in the project root that the writer's worktree (cut from
       * `HEAD`) does not hold: what `ork init` made just now, and any other
       * uncommitted file under `.ork/` or `.gitignore`; empty when none.
       */
      fromInit: string[];
    } & Overview)
  | { kind: "stop"; lines: readonly string[]; code: number };

/** The line the writer is told about uncommitted files, or "" for none. */
export const initNote = (fromInit: readonly string[]): string =>
  fromInit.length === 0
    ? ""
    : `Not in your worktree: these files in the project folder are uncommitted (${fromInit.join(", ")}), so your worktree does not hold them; do not look for them or recreate them.`;

/**
 * The paths under `.ork/` and `.gitignore` of `root` that git reports modified
 * or untracked (ignored ones, such as `.ork/runs/`, are not reported). Empty
 * when git fails: not a repository, or no git.
 */
export const uncommittedFiles = (root: string): string[] => {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=all",
        "--",
        ".ork",
        ".gitignore",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return [];
  }
  const entries = out.split("\0");
  const files: string[] = [];
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at] ?? "";
    const status = entry.slice(0, 2);
    // A rename or copy is followed by its source path.
    if (status.startsWith("R") || status.startsWith("C")) at++;
    // A deleted file is still in `HEAD`, so the worktree holds it.
    if (entry !== "" && !status.includes("D")) files.push(entry.slice(3));
  }
  return files;
};

/** `fromInit`'s items, then the git-reported paths no item already names. */
export const withUncommitted = (
  fromInit: readonly string[],
  reported: readonly string[],
): string[] => [
  ...fromInit,
  ...reported.filter(
    file =>
      !fromInit.some(item => item === file || item.startsWith(`${file} `)),
  ),
];

/** Everything up to the questions, or why to stop. */
export const prepare = async (o: OnboardOptions): Promise<Prepared> => {
  const { out, store } = o;
  const refused = await refusal({ ...o, registered: store.projects() });
  if (refused !== null) return { kind: "stop", lines: refused, code: 1 };

  // The driver first: with none ready, nothing is written.
  const picked = await pickDriver(o.io, o.driver, o.checks);
  if (picked.kind === "stop") {
    return { kind: "stop", lines: picked.lines, code: picked.code };
  }

  let gitignored = false;
  let fromInit: string[] = [];
  let place = placeFor(o.cwd, store.projects());
  // Set up at the project's root, which is not `cwd` in a subfolder.
  if (!existsSync(place.dir)) {
    const made = initRecorded(store, place.root, { link: false });
    if ("error" in made) return { kind: "stop", lines: [made.error], code: 1 };
    for (const item of made.created) {
      out(`${style("green", "created")} ${item}`);
    }
    fromInit = made.created;
    gitignored = made.created.some(item => item.startsWith(".gitignore"));
    place = placeFor(o.cwd, store.projects());
  }

  return {
    kind: "ready",
    place,
    driver: picked.driver,
    gitignored,
    fromInit: withUncommitted(fromInit, uncommittedFiles(place.root)),
    ...(await overview(store, place.root, o, out)),
  };
};
