#!/usr/bin/env node
/**
 * @file The `ork` executable: runs the CLI's root command. The published
 *   package's `bin` points at its bundle. When the new-version check is on, it
 *   starts the daily background check and ends with the notice (ADR-038); the
 *   background copy it starts only runs the check.
 */

import { runMain } from "citty";

import { main } from "./main.ts";
import {
  runUpdateChild,
  showUpdateNotice,
  startUpdateCheck,
  UPDATE_CHILD_ENV,
  updateCheckOff,
} from "./update/notify.ts";

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
  await runMain(main);
}
