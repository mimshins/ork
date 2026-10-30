/** @file The root `ork` command and its subcommands. */

import { defineCommand } from "citty";

import {
  chat,
  context,
  decide,
  doctor,
  init,
  logs,
  ps,
  resume,
  run,
  stop,
  tree,
  validate,
  worktrees,
} from "./commands/index.ts";

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
    context,
    worktrees,
    wt: worktrees,
    doctor,
  },
});
