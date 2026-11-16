/** @file What `ork onboard` takes: the project, the terminal and the flags. */

import type { PromptIO } from "../term/mode.ts";
import type { pickDriver } from "./driver.ts";
import type { RefusalInput } from "./refusals.ts";
import type { RunOptions } from "./runs.ts";

export type OnboardOptions = Omit<RunOptions, "place" | "driver"> &
  Pick<RefusalInput, "cwd" | "interactive" | "exec" | "nodeVersion"> & {
    io: PromptIO;
    /** `--driver`, as typed. */
    driver?: string | undefined;
    review: boolean;
    fresh: boolean;
    /** The drivers' checks; tests pass their own. */
    checks?: Parameters<typeof pickDriver>[2];
  };
