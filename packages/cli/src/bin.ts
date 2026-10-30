#!/usr/bin/env node
/**
 * @file The `ork` executable: runs the CLI's root command. The published
 *   package's `bin` points at its bundle.
 */

import { runMain } from "citty";

import { main } from "./main.ts";

await runMain(main);
