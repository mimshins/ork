/**
 * @file The root `ork` command and its subcommands. `ork --help` lists them in
 *   the groups of `help-groups.ts`.
 */

import { type CommandDef, defineCommand } from "citty";

import { chat } from "./commands/chat.ts";
import { context } from "./commands/context.ts";
import { decide, resume, stop } from "./commands/control.ts";
import { doctor, ORK_META, upgrade } from "./commands/install.ts";
import { migrate, projects, register } from "./commands/projects.ts";
import { run } from "./commands/run.ts";
import { feedback, logs, ps, tree } from "./commands/runs.ts";
import { agents, init, link } from "./commands/setup.ts";
import { validate } from "./commands/validate.ts";

export const main: CommandDef = defineCommand({
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
    // Loaded on use, like `ork ui`.
    attach: () => import("./commands/attach.ts").then(module => module.attach),
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
    // Loaded on use: it needs only git and the core.
    once: () => import("./commands/once.ts").then(module => module.once),
    // Loaded on use: a program may call it many times in a run.
    send: () => import("./commands/send.ts").then(module => module.send),
    resume,
    feedback,
    // Loaded on use, like `ork ui`.
    "follow-ups": () =>
      import("./commands/follow-ups.ts").then(module => module.followUps),
    context,
    // Loaded on use, like `ork ui`.
    worktrees: () =>
      import("./commands/worktrees.ts").then(module => module.worktrees),
    wt: () =>
      import("./commands/worktrees.ts").then(module => module.worktrees),
    // Loaded on use: most commands never need it.
    watch: () => import("./commands/watch.ts").then(module => module.watch),
    // Loaded on use: it loads the server and the MCP SDK.
    mcp: () => import("./commands/mcp.ts").then(module => module.mcp),
    // Loaded only for `ork ui`, so other commands do not load the server.
    ui: () => import("./commands/ui.ts").then(module => module.ui),
    doctor,
    upgrade,
    // Loaded on use: only a shell's setup asks for it.
    completion: () =>
      import("./commands/completion.ts").then(module => module.completion),
    // Hidden: what the completion scripts run; `bin.ts` runs it first.
    __complete: (): Promise<CommandDef> =>
      import("./commands/completion.ts").then(module =>
        module.completeCommand(main),
      ),
  },
});
