/**
 * @file Limits across runs (RFC-007): what the user's and a project's quotas
 *   allow, read from the ledger, and what Claude Code last said about the plan.
 *   Windows are the same calendar days, weeks and months `ork usage` shows, in
 *   the machine's time zone, so the two never disagree.
 */

import type { Quotas } from "@krapht/ork-schema";

import type { PlanLimit } from "../runtime/types.ts";
import type { UsageStore } from "../store/types.ts";

const WINDOWS = ["day", "week", "month"] as const;
export type QuotaWindow = (typeof WINDOWS)[number];

const FIELDS = {
  day: "dayUsd",
  week: "weekUsd",
  month: "monthUsd",
} as const;

/** The windows a quota in counted tokens (RFC-015) has, and their fields. */
const TOKEN_FIELDS: Partial<Record<QuotaWindow, "dayTokens">> = {
  day: "dayTokens",
};

/** A cap on one window; with no `project`, on every project here. */
export type QuotaCap = {
  window: QuotaWindow;
  capUsd: number;
  project?: string;
};

/** A cap in counted tokens on one window (`quotas.dayTokens`). */
export type TokenCap = {
  window: QuotaWindow;
  capTokens: number;
  project?: string;
};

/** Any cap across runs, in dollars or in tokens. */
export type AnyCap = QuotaCap | TokenCap;

const inTokens = (cap: AnyCap): cap is TokenCap => "capTokens" in cap;

export type QuotaStanding = QuotaCap & {
  spentUsd: number;
  leftUsd: number;
  /** When a new window starts. */
  resetsAt: string;
};

export type TokenStanding = TokenCap & {
  spentTokens: number;
  leftTokens: number;
  resetsAt: string;
};

/**
 * What a run may do now: how much it may spend, in dollars and in counted
 * tokens, and why it may not start.
 */
export type RunLimits = {
  leftUsd?: number;
  leftTokens?: number;
  blocked?: string;
};

export type LimitsReport = {
  /** Settings that could not be read, so the caps here may not be all there are. */
  problems: string[];
  caps: QuotaStanding[];
  /**
   * The caps in counted tokens, beside `caps` (RFC-015); `limitsReport` sets
   * it.
   */
  tokenCaps?: TokenStanding[];
  /** The plan limits Claude Code last reported that are not plain `allowed`. */
  plan: PlanLimit[];
};

/** Where a window began and when the next begins, in local time. */
export const windowOf = (
  window: QuotaWindow,
  now: Date,
): { since: Date; until: Date } => {
  const [year, month, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  if (window === "month") {
    return {
      since: new Date(year, month, 1),
      until: new Date(year, month + 1),
    };
  }
  if (window === "day") {
    return {
      since: new Date(year, month, day),
      until: new Date(year, month, day + 1),
    };
  }
  const monday = day - ((now.getDay() + 6) % 7);
  return {
    since: new Date(year, month, monday),
    until: new Date(year, month, monday + 7),
  };
};

/**
 * The caps that apply: the user's on everything, and the project's on itself;
 * those in dollars, then those in tokens.
 */
export const capsOf = (
  user: Quotas | undefined,
  project?: Quotas,
  root?: string,
): AnyCap[] => {
  const whose = <C extends AnyCap>(
    field: keyof Quotas,
    cap: (amount: number) => C,
  ): C[] => {
    const everywhere = user?.[field];
    const here = project?.[field];
    return [
      ...(everywhere === undefined ? [] : [cap(everywhere)]),
      ...(here === undefined || root === undefined
        ? []
        : [Object.assign(cap(here), { project: root })]),
    ];
  };
  return [
    ...WINDOWS.flatMap(window =>
      whose(FIELDS[window], capUsd => ({ window, capUsd })),
    ),
    ...WINDOWS.flatMap(window => {
      const field = TOKEN_FIELDS[window];
      return field === undefined
        ? []
        : whose(field, capTokens => ({ window, capTokens }));
    }),
  ];
};

/** Each cap in dollars with what has been spent against it. */
export const standingOf = (
  store: Pick<UsageStore, "spentSince">,
  caps: readonly AnyCap[],
  now: Date,
): QuotaStanding[] =>
  caps.flatMap(cap => {
    if (inTokens(cap)) return [];
    const { since, until } = windowOf(cap.window, now);
    const spentUsd = store.spentSince(since.toISOString(), cap.project);
    return [
      {
        ...cap,
        spentUsd,
        leftUsd: cap.capUsd - spentUsd,
        resetsAt: until.toISOString(),
      },
    ];
  });

/** Each cap in tokens with the counted tokens used against it. */
export const tokenStandingOf = (
  store: Pick<UsageStore, "spentSince">,
  caps: readonly AnyCap[],
  now: Date,
): TokenStanding[] =>
  caps.flatMap(cap => {
    if (!inTokens(cap)) return [];
    const { since, until } = windowOf(cap.window, now);
    const spentTokens = store.spentSince(
      since.toISOString(),
      cap.project,
      "tokens",
    );
    return [
      {
        ...cap,
        spentTokens,
        leftTokens: cap.capTokens - spentTokens,
        resetsAt: until.toISOString(),
      },
    ];
  });

/** Dollars: cents, or more digits for an amount under a dollar. */
export const usd = (amount: number): string =>
  `$${amount.toFixed(amount > 0 && amount < 1 ? 4 : 2)}`;

const at = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const capReason = (spent: QuotaStanding | TokenStanding): string => {
  const [cap, used] =
    "capTokens" in spent
      ? [`${String(spent.capTokens)} tokens`, String(spent.spentTokens)]
      : [usd(spent.capUsd), usd(spent.spentUsd)];
  return `${spent.project === undefined ? "your" : "this project's"} ${spent.window} quota of ${cap} is spent (${used}); it lifts on ${at(spent.resetsAt)}, or raise it in ${spent.project === undefined ? "~/.ork/settings.yaml" : ".ork/project.yaml"}`;
};

/** What a run or a call refused at its start says first, for its caller to read. */
export const NOT_STARTED = "Not started: ";

/** Why a plan limit stops a run. */
export const planReason = (limit: {
  window: string;
  resetsAt?: string;
}): string =>
  `your Claude plan's ${limit.window.replaceAll("_", " ")} limit was reached${limit.resetsAt === undefined ? "" : `; it resets on ${at(limit.resetsAt)}, or use ork usage --clear-plan-limits if it has lifted`}`;

/**
 * The windows that hold the whole account. One for a single model, such as
 * `seven_day_opus`, stops only the session it refused: other models may be
 * free.
 */
const ACCOUNT_WINDOWS: ReadonlySet<string> = new Set([
  "five_hour",
  "seven_day",
  "overage",
  "plan",
]);

/** The plan limits in force, the one that lifts last first. */
const refusing = (limits: readonly PlanLimit[], now: Date): PlanLimit[] =>
  limits
    .filter(
      limit =>
        limit.status === "rejected" &&
        ACCOUNT_WINDOWS.has(limit.window) &&
        limit.resetsAt !== undefined &&
        Date.parse(limit.resetsAt) > now.getTime(),
    )
    .toSorted((a, b) => String(b.resetsAt).localeCompare(String(a.resetsAt)));

/** How long a report with no reset time stays worth showing. */
const SHOWN_MS = 24 * 60 * 60 * 1000;

/** What the caps and the plan allow a run now. */
export const limitsNow = (
  store: Pick<UsageStore, "spentSince" | "planLimits">,
  caps: readonly AnyCap[],
  now: Date,
): RunLimits => {
  const standing = standingOf(store, caps, now);
  const tokens = tokenStandingOf(store, caps, now);
  const [plan] = refusing(store.planLimits(), now);
  const spent =
    standing.find(cap => cap.leftUsd <= 0) ??
    tokens.find(cap => cap.leftTokens <= 0);
  const blocked =
    plan === undefined
      ? spent === undefined
        ? undefined
        : capReason(spent)
      : planReason(plan);
  return {
    ...(standing.length === 0
      ? {}
      : { leftUsd: Math.min(...standing.map(cap => cap.leftUsd)) }),
    ...(tokens.length === 0
      ? {}
      : { leftTokens: Math.min(...tokens.map(cap => cap.leftTokens)) }),
    ...(blocked === undefined ? {} : { blocked }),
  };
};

/** What `ork usage` and the panel show. */
export const limitsReport = (
  store: Pick<UsageStore, "spentSince" | "planLimits">,
  { caps, problems }: { caps: readonly AnyCap[]; problems: string[] },
  now: Date,
): LimitsReport => ({
  problems,
  caps: standingOf(store, caps, now),
  tokenCaps: tokenStandingOf(store, caps, now),
  plan: store.planLimits().filter(limit => {
    if (limit.status === "allowed") return false;
    const until =
      limit.resetsAt === undefined
        ? Date.parse(limit.at) + SHOWN_MS
        : Date.parse(limit.resetsAt);
    return until > now.getTime();
  }),
});
