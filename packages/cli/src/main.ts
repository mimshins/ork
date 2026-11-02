/** @file The root `ork` command and its subcommands. */

import { defineCommand } from "citty";

import { chat } from "./commands/chat.ts";
import { context } from "./commands/context.ts";
import { decide, resume, stop } from "./commands/control.ts";
import { doctor, ORK_META, upgrade } from "./commands/install.ts";
import { migrate, projects, register, worktrees } from "./commands/projects.ts";
import { run } from "./commands/run.ts";
import { feedback, logs, ps, tree } from "./commands/runs.ts";
import { agents, init, link } from "./commands/setup.ts";
import { validate } from "./commands/validate.ts";

export const main = defineCommand({
  meta: ORK_META,
  subCommands: {
    init,
    register,
    projects,
    migrate,
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
    // Loaded only for `ork ui`, so other commands do not load the server.
    ui: () => import("./commands/ui.ts").then(module => module.ui),
    doctor,
    upgrade,
  },
});
