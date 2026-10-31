/** @file The root `ork` command and its subcommands. */

import { defineCommand } from "citty";

import { ORK_VERSION } from "./__build_info__.ts";
import { chat } from "./commands/chat.ts";
import { context } from "./commands/context.ts";
import { decide, resume, stop } from "./commands/control.ts";
import { projects, register, worktrees } from "./commands/projects.ts";
import { run } from "./commands/run.ts";
import { feedback, logs, ps, tree } from "./commands/runs.ts";
import { agents, doctor, init, link } from "./commands/setup.ts";
import { validate } from "./commands/validate.ts";

export const main = defineCommand({
  meta: {
    name: "ork",
    version: ORK_VERSION,
    description: "Orchestrate Claude agents on your machine",
  },
  subCommands: {
    init,
    register,
    projects,
    link,
    validate,
    agents,
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
