/** @file The root `ork` command and its subcommands. */

import { defineCommand } from "citty";

import { context } from "./commands/context.ts";
import { doctor } from "./commands/doctor.ts";
import { init } from "./commands/init.ts";
import { run } from "./commands/run.ts";
import { validate } from "./commands/validate.ts";
import { worktrees } from "./commands/worktrees.ts";

export const main = defineCommand({
  meta: {
    name: "ork",
    version: "0.0.0",
    description: "Orchestrate Claude agents on your machine",
  },
  subCommands: {
    init,
    validate,
    run,
    context,
    worktrees,
    wt: worktrees,
    doctor,
  },
});
