/**
 * @file The driver both of `ork onboard`'s built-in runs use: `--driver <id>`
 *   as given, the only ready one, a `select` among several, or the logins to
 *   fix when none is ready (specs/cli/onboard-flow.md#the-driver). It reads
 *   `ork doctor`'s own checks and starts no session.
 */

import {
  type DriverCheck,
  PREFERRED_DRIVER,
  readyDriver,
} from "@krapht/ork-integrations";
import type { Driver } from "@krapht/ork-schema";

import { badDriver, isDriver } from "../run/drivers.ts";
import {
  checksHere,
  type DriverChecks,
  overrideRefusal,
} from "../run/ready-driver.ts";
import type { PromptIO } from "../term/mode.ts";
import { select } from "../term/select.ts";

export type Picked =
  | { kind: "driver"; driver: Driver }
  /** Nothing to run on: the lines to print, and the exit code. */
  | { kind: "stop"; lines: string[]; code: number };

/** The driver to use, asking only when several are ready and none was named. */
export const pickDriver = async (
  io: PromptIO,
  flag: string | undefined,
  checks: DriverChecks = checksHere,
): Promise<Picked> => {
  if (flag !== undefined) {
    if (!isDriver(flag)) {
      return { kind: "stop", lines: [badDriver(flag)], code: 1 };
    }
    const refusal = await overrideRefusal(flag, checks);
    return refusal.length > 0
      ? { kind: "stop", lines: refusal, code: 1 }
      : { kind: "driver", driver: flag };
  }
  const found = await checks();
  const ready = found.filter(({ result }) => result.status === "ok");
  const only = ready.at(0);
  if (only === undefined) {
    const none = readyDriver(found);
    return {
      kind: "stop",
      lines: [
        "No agent driver is ready here, and ork onboard needs one.",
        ...(none.ok ? [] : none.hints),
        "See `ork doctor`.",
      ],
      code: 1,
    };
  }
  if (ready.length === 1) return { kind: "driver", driver: only.id };
  return chooseAmong(io, ready);
};

const chooseAmong = async (
  io: PromptIO,
  ready: readonly DriverCheck[],
): Promise<Picked> => {
  const recommended = ready.some(({ id }) => id === PREFERRED_DRIVER)
    ? PREFERRED_DRIVER
    : (ready.at(0)?.id ?? PREFERRED_DRIVER);
  const answer = await select(io, {
    header: () => ["Which driver should both onboarding runs use?"],
    options: ready.map(({ id, result }) => ({
      id,
      description: result.detail,
    })),
    recommended,
  });
  if (answer.kind === "chosen" && isDriver(answer.id)) {
    return { kind: "driver", driver: answer.id };
  }
  return answer.kind === "interrupted"
    ? { kind: "stop", lines: [], code: 130 }
    : { kind: "stop", lines: ["No driver chosen; nothing started."], code: 0 };
};
