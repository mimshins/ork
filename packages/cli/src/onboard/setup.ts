/**
 * @file The free steps of `ork onboard` that come before any question: the
 *   refusals, the driver, `ork init`'s file steps when `.ork/` is missing, and
 *   the overview (specs/cli/onboard-flow.md). Nothing here starts a session or
 *   spends.
 */

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
       * What `ork init` made in the project root just now, which the writer's
       * worktree (cut from `HEAD`) does not hold; empty when `.ork/` was
       * there.
       */
      fromInit: string[];
    } & Overview)
  | { kind: "stop"; lines: readonly string[]; code: number };

/** The line the writer is told about files `ork init` made, or "" for none. */
export const initNote = (fromInit: readonly string[]): string =>
  fromInit.length === 0
    ? ""
    : `Not in your worktree: \`ork onboard\` just set .ork/ up in the project folder and made ${fromInit.join(", ")}. They are uncommitted, so your worktree does not hold them; do not look for them or recreate them.`;

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
    fromInit,
    ...(await overview(store, place.root, o, out)),
  };
};
