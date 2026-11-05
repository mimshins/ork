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
    // Loaded on use, like `ork ui`.
    usage: () => import("./commands/usage.ts").then(module => module.usage),
    prune: () => import("./commands/usage.ts").then(module => module.prune),
    decide,
    // Loaded on use, like `ork ui`.
    relay: () => import("./commands/relay.ts").then(module => module.relay),
    pause: () => import("./commands/pause.ts").then(module => module.pause),
    continue: () =>
      import("./commands/pause.ts").then(module => module.continueRun),
    stop,
    chat,
    // Loaded on use: a program may call it many times in a run.
    send: () => import("./commands/send.ts").then(module => module.send),
    resume,
    feedback,
    context,
    worktrees,
    wt: worktrees,
    // Loaded on use: most commands never need it.
    watch: () => import("./commands/watch.ts").then(module => module.watch),
    // Loaded on use: it loads the server and the MCP SDK.
    mcp: () => import("./commands/mcp.ts").then(module => module.mcp),
    // Loaded only for `ork ui`, so other commands do not load the server.
    ui: () => import("./commands/ui.ts").then(module => module.ui),
    doctor,
    upgrade,
  },
});
