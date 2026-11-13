/**
 * @file The single-use sign-in codes of `ork ui` (RFC-019): `mint` makes one,
 *   `redeem` spends it. A code lives 60 seconds, in memory only, so a restart
 *   drops the unused ones. 32 random bytes, so a lookup by value leaks nothing
 *   a guess could use.
 */

import { randomBytes } from "node:crypto";

/** How long a minted code stays good, in seconds. */
export const CODE_LIFETIME_SECONDS = 60;

export type SignInCodes = {
  /** A new code; the expired ones are dropped first. */
  mint: () => string;
  /** Whether `code` was minted, is unexpired and unused; it is spent either way. */
  redeem: (code: string) => boolean;
};

/** `now` is injectable so a test can move the clock. */
export const createSignInCodes = (
  now: () => number = Date.now,
): SignInCodes => {
  const expiries = new Map<string, number>();
  return {
    mint: () => {
      for (const [code, expiry] of expiries) {
        if (expiry <= now()) expiries.delete(code);
      }
      const code = randomBytes(32).toString("base64url");
      expiries.set(code, now() + CODE_LIFETIME_SECONDS * 1000);
      return code;
    },
    redeem: code => {
      const expiry = expiries.get(code);
      expiries.delete(code);
      return expiry !== undefined && expiry > now();
    },
  };
};
