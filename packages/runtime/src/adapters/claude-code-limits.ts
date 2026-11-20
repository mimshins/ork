/**
 * @file Reads the `claude` CLI's `rate_limit_event` into a `plan.limit` event
 *   (RFC-007): which window, whether it is allowed, close or refused, and when
 *   it resets.
 */

import type { RuntimeEvent } from "@krapht/ork-core";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

/** The year 2286: a reset beyond this is not in seconds. */
const MAX_RESET_SECONDS = 1e10;

/**
 * What a subscription's limit said (RFC-007). Only the fields Claude Code
 * documents are read, so `utilization`, often absent, plays no part.
 */
export const planLimitOf = (info: unknown): RuntimeEvent[] => {
  const status = get(info, "status");
  if (
    status !== "allowed" &&
    status !== "allowed_warning" &&
    status !== "rejected"
  ) {
    return [];
  }
  const window = get(info, "rateLimitType");
  const resets = get(info, "resetsAt");
  const overage = get(info, "overageStatus");
  // A plan with extra usage to draw on goes on past its own limit.
  const refused =
    status === "rejected" &&
    overage !== "allowed" &&
    overage !== "allowed_warning";
  // Claude Code warns at the top while the window says `allowed` (seen at 31%).
  const own = get(get(get(info, "unifiedWindows"), String(window)), "status");
  const warned = own === "allowed" && !refused ? "allowed" : status;
  return [
    {
      type: "plan.limit",
      status: status === "rejected" && !refused ? "allowed_warning" : warned,
      window: typeof window === "string" ? window : "plan",
      // In seconds: anything else would hold every run for ever.
      ...(typeof resets === "number" && resets > 0 && resets < MAX_RESET_SECONDS
        ? { resetsAt: new Date(resets * 1000).toISOString() }
        : {}),
    },
  ];
};
