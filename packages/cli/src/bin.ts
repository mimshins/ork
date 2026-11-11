#!/usr/bin/env node
/**
 * @file The `ork` executable: runs the CLI's root command. The published
 *   package's `bin` points at its bundle. When the new-version check is on, it
 *   starts the daily background check and ends with the notice (ADR-038); the
 *   background copy it starts only runs the check. It first clears git's local
 *   variables (a hook's `GIT_DIR`, `GIT_INDEX_FILE`, …), so nothing Ork starts
 *   acts on the hook's repository (specs/worktrees.md). The global `--plain`
 *   flag is taken out of the arguments and set as `ORK_PLAIN=1`. `--help`
 *   leaves out the flags only Ork passes to itself. `ork __complete`, which tab
 *   completion runs on every Tab, goes first: no update check, and no citty, so
 *   a typed `--help` is a word to complete. `ork once -- <command>` skips
 *   citty's help scan, so a `--help` or `-h` of the command is the command's.
 */

import { clearGitLocalEnv } from "@krapht/ork-core";
import { runCommand, runMain } from "citty";

import { COMPLETE_COMMAND } from "./completion/scripts.ts";
import { showHelp } from "./help.ts";
import { main } from "./main.ts";
import { takePlainFlag } from "./term/mode.ts";
import {
  runUpdateChild,
  showUpdateNotice,
  startUpdateCheck,
  UPDATE_CHILD_ENV,
  updateCheckOff,
} from "./update/notify.ts";

clearGitLocalEnv();

// The global `--plain` becomes `ORK_PLAIN=1`, which the term kit reads.
const argv = takePlainFlag(process.argv.slice(2));

if (argv[0] === COMPLETE_COMMAND) {
  const { printCompletions } = await import("./commands/completion.ts");
  await printCompletions(main, argv.slice(1));
} else if (process.env[UPDATE_CHILD_ENV] === "1") {
  await runUpdateChild();
} else {
  if (updateCheckOff(process.env, argv, process.stderr.isTTY) === null) {
    startUpdateCheck();
    process.once("exit", () => {
      showUpdateNotice();
    });
  }
  const dash = argv.indexOf("--");
  const askedHelp = argv
    .slice(1, dash === -1 ? 0 : dash)
    .some(arg => arg === "--help" || arg === "-h");
  if (argv[0] === "once" && dash !== -1 && !askedHelp) {
    // runMain shows help for a `--help` or `-h` anywhere, even in the command
    // after `--`, and the wrapped check would never run.
    try {
      const { once } = await import("./commands/once.ts");
      await runCommand(once, { rawArgs: argv.slice(1) });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    await runMain(main, { rawArgs: argv, showUsage: showHelp });
  }
}
