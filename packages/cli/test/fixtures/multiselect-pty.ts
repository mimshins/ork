/**
 * @file Run on a pty by `multiselect-pty.test.ts`: asks the real `multiselect`
 *   a question of three options on `process.stdin` and `process.stderr`, then
 *   prints `RESULT <json>` (the answer, and whether the input is still in raw
 *   mode) on stdout. Ctrl-C does not signal itself here: the answer is
 *   `interrupted` and the state is printed instead.
 */

import { multiselect } from "../../src/term/multiselect.ts";

const answer = await multiselect(
  {
    input: process.stdin,
    output: process.stderr,
    env: process.env,
    interrupt: () => undefined,
  },
  {
    header: () => ["Which?"],
    options: [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }],
    later: true,
  },
);
process.stdout.write(
  `RESULT ${JSON.stringify({ ...answer, raw: process.stdin.isRaw })}\n`,
);
