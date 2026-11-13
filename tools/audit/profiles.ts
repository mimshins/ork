/**
 * @file The security audit's profiles: how many ledger units get a hunter and
 *   how many candidates get a verifier. A run's cap (`limits.budgetUsd`) is one
 *   number that no input can lower, so each profile's cap is kept by counting:
 *   the `ledger` and `consolidate` steps limit what each `forEach` receives,
 *   and every agent node carries its own `budgetUsd` (§6 of the audit
 *   workflow's plan).
 */

export const PROFILE_NAMES = ["quick", "standard"] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

export type Profile = {
  /** Ledger units that get a hunter; the rest are written as `deferred`. */
  hunters: number;
  /** Candidates that get a verifier; the rest are `needs_validation`. */
  verifiers: number;
  /** Confirmed records the `recheck` node looks at again. */
  rechecks: number;
  /** The most the whole run may spend, in US dollars. */
  capUsd: number;
};

export const PROFILES: Record<ProfileName, Profile> = {
  quick: { hunters: 8, verifiers: 12, rechecks: 0, capUsd: 30 },
  standard: { hunters: 20, verifiers: 30, rechecks: 20, capUsd: 80 },
};

/** Each agent node's `budgetUsd` in `audit.ork.yaml` (starting figures). */
export const NODE_BUDGETS_USD = {
  recon: 4,
  hunt: 2,
  critic: 1.5,
  verify: 0.5,
  recheck: 0.5,
  report: 1.5,
} as const;

/** The most a profile can spend: each node's budget times its count. */
export const maxSpendUsd = (profile: ProfileName): number => {
  const { hunters, verifiers, rechecks } = PROFILES[profile];
  return (
    NODE_BUDGETS_USD.recon +
    NODE_BUDGETS_USD.hunt * hunters +
    NODE_BUDGETS_USD.critic +
    NODE_BUDGETS_USD.verify * verifiers +
    NODE_BUDGETS_USD.recheck * rechecks +
    NODE_BUDGETS_USD.report
  );
};

/**
 * How many agent invocations a profile makes at most (`run-metadata.json`'s
 * `budget`).
 */
export const maxInvocations = (profile: ProfileName): number => {
  const { hunters, verifiers, rechecks } = PROFILES[profile];
  return 1 + hunters + 1 + verifiers + rechecks + 1;
};
