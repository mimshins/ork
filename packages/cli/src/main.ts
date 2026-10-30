/** @file The root `ork` command and its subcommands. */

import { defineCommand } from "citty";

import { chat } from "./commands/chat.ts";
import { context } from "./commands/context.ts";
import { decide, resume, stop } from "./commands/control.ts";
import { doctor } from "./commands/doctor.ts";
import { init } from "./commands/init.ts";
import { run } from "./commands/run.ts";
import { feedback, logs, ps, tree } from "./commands/runs.ts";
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
    ps,
    logs,
    tree,
    decide,
    stop,
    chat,
    resume,
    feedback,
    context,
    worktrees,
    wt: worktrees,
    doctor,
  },
});
