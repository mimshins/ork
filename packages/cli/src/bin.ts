#!/usr/bin/env node
/**
 * @file The `ork` executable: runs the CLI's root command. The published
 *   package's `bin` points at its bundle. When the new-version check is on, it
 *   starts the daily background check and ends with the notice (ADR-038); the
 *   background copy it starts only runs the check. It first clears git's local
 *   variables (a hook's `GIT_DIR`, `GIT_INDEX_FILE`, …), so nothing Ork starts
 *   acts on the hook's repository (specs/worktrees.md). `--help` leaves out the
 *   flags only Ork passes to itself.
 */

import { clearGitLocalEnv } from "@krapht/ork-core";
import { runMain } from "citty";

import { showHelp } from "./help.ts";
import { main } from "./main.ts";
import {
  runUpdateChild,
  showUpdateNotice,
  startUpdateCheck,
  UPDATE_CHILD_ENV,
  updateCheckOff,
} from "./update/notify.ts";

clearGitLocalEnv();

if (process.env[UPDATE_CHILD_ENV] === "1") {
  await runUpdateChild();
} else {
  const argv = process.argv.slice(2);
  if (updateCheckOff(process.env, argv, process.stderr.isTTY) === null) {
    startUpdateCheck();
    process.once("exit", () => {
      showUpdateNotice();
    });
  }
  await runMain(main, { showUsage: showHelp });
}
