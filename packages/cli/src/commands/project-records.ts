/**
 * @file `ork projects`' subcommands on one project's record (ADR-035): `forget`
 *   drops it and keeps its files and runs; `move` points it at its clone's new
 *   place after the clone was moved or renamed, and its runs follow.
 */

import { openStore } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { refuseExtraArguments } from "../extra-arguments.ts";
import { style, write, writeErr } from "../output.ts";
import { relocateProject } from "../project/register.ts";

/** Runs `use` with the store open, and closes it. */
export const withStore = <T>(
  use: (store: ReturnType<typeof openStore>) => T,
): T => {
  const store = openStore();
  try {
    return use(store);
  } finally {
    store.close();
  }
};

const id = {
  type: "positional",
  description: "The project's id",
  required: true,
} as const;

export const forget = defineCommand({
  meta: {
    name: "forget",
    description: "Forget a registered project; its files and runs are kept",
  },
  plugins: [refuseExtraArguments],
  args: { id },
  run: ({ args }) => {
    if (withStore(store => store.forgetProject(args.id))) {
      write(`${style("green", "forgot")} ${args.id} (its files are kept)`);
      return;
    }
    writeErr(`No project is registered as ${args.id}.`);
    process.exitCode = 1;
  },
});

export const move = defineCommand({
  meta: {
    name: "move",
    description:
      "Point a registered project at its clone's new place, after moving or renaming it",
  },
  plugins: [refuseExtraArguments],
  args: {
    id,
    path: {
      type: "positional",
      description: "Where the clone is now",
      required: true,
    },
  },
  run: ({ args }) => {
    const result = withStore(store =>
      relocateProject(store, args.id, args.path),
    );
    if (result.ok) {
      write(`${style("green", "moved")} ${args.id} → ${result.project.root}`);
      return;
    }
    writeErr(result.error);
    process.exitCode = 1;
  },
});
