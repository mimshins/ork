/**
 * @file `ork onboard` (RFC-018): a forward-deployed engineer built into Ork. It
 *   reads the project, asks what hurts, proposes workflows that fit, writes the
 *   ones the person picks on a branch and ends at a gate that shows the diff.
 *   The steps are in `onboard/flow.ts`; this file is the flags and the terminal
 *   they run on.
 */

import { openStore } from "@krapht/ork-core";
import { DRIVER_IDS } from "@krapht/ork-integrations";
import { defineCommand } from "citty";

import { ORK_VERSION } from "../__build_info__.ts";
import { exec } from "../doctor/checks.ts";
import { runOnboard } from "../onboard/flow.ts";
import { write, writeErr } from "../output.ts";
import { loadRuntime, onInterrupt, terminalHuman } from "./run.ts";

export const onboard = defineCommand({
  meta: {
    name: "onboard",
    description:
      "Have Ork read this project, ask what hurts, and write workflows that fit, on a branch you keep or discard",
  },
  args: {
    driver: {
      type: "string",
      description: `${DRIVER_IDS.join(", ")} (default: the driver ready here)`,
    },
    review: {
      type: "boolean",
      description:
        "Review what this project's runs showed, even if it has none yet",
      default: false,
    },
    fresh: {
      type: "boolean",
      description:
        "Start as a first visit, even if it holds workflows and runs",
      default: false,
    },
  },
  run: async ({ args }) => {
    const store = openStore(undefined, { version: ORK_VERSION });
    const human = terminalHuman();
    try {
      process.exitCode = await runOnboard({
        cwd: process.cwd(),
        store,
        io: { input: process.stdin, output: process.stderr },
        interactive: process.stdin.isTTY && process.stderr.isTTY,
        exec,
        nodeVersion: process.versions.node,
        driver: args.driver,
        review: args.review,
        fresh: args.fresh,
        runtime: loadRuntime,
        ...(human === undefined ? {} : { human }),
        out: write,
        err: writeErr,
        onRun: handle => {
          onInterrupt(handle.interrupt);
        },
      });
    } finally {
      human?.close();
      store.close();
    }
  },
});
