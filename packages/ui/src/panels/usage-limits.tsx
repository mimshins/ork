/**
 * @file The limits across runs on the Usage panel (RFC-007): what each cap has
 *   left and when it resets, and any plan limit in force.
 */

import type { LimitsReport } from "@krapht/ork-server/client";
import { Fragment } from "react";

import { CodeText } from "../components/code-text.tsx";
import { Meter } from "../components/meter.tsx";
import { formatTokenCap, formatTokens } from "../graph/facts.ts";

import styles from "./usage.module.css";

const WHOSE = (project: string | undefined): string =>
  project === undefined ? "All projects" : "This project";

const usd = (amount: number): string => `$${amount.toFixed(2)}`;

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

type TokenCap = NonNullable<LimitsReport["tokenCaps"]>[number];

const keyOf = (cap: { project?: string | undefined; window: string }): string =>
  `${cap.project ?? "all"}-${cap.window}`;

const TokenMeter = ({ cap }: { cap: TokenCap }) => (
  <Meter
    label={`${WHOSE(cap.project)}, this ${cap.window}, in tokens`}
    max={cap.capTokens}
    text={`${formatTokens(cap.spentTokens)} of ${formatTokenCap(cap.capTokens)} tokens, resets ${when(cap.resetsAt)}${cap.spentTokens >= cap.capTokens ? ", reached" : ""}`}
    value={Math.min(cap.spentTokens, cap.capTokens)}
  />
);

export const UsageLimits = ({ limits }: { limits: LimitsReport }) => {
  const tokenCaps = limits.tokenCaps ?? [];
  const paired = new Set(limits.caps.map(keyOf));
  return limits.problems.length === 0 &&
    limits.caps.length === 0 &&
    tokenCaps.length === 0 &&
    limits.plan.length === 0 ? null : (
    <section
      aria-label="Limits"
      className={styles["limits"]}
    >
      {limits.problems.map(problem => (
        <p
          className={styles["note"]}
          key={problem}
        >
          <CodeText text={problem} />
        </p>
      ))}
      {limits.caps.map(cap => (
        <Fragment key={keyOf(cap)}>
          <Meter
            label={`${WHOSE(cap.project)}, this ${cap.window}`}
            max={cap.capUsd}
            text={`${usd(cap.spentUsd)} of ${usd(cap.capUsd)}, resets ${when(cap.resetsAt)}`}
            value={Math.min(cap.spentUsd, cap.capUsd)}
          />
          {tokenCaps
            .filter(token => keyOf(token) === keyOf(cap))
            .map(token => (
              <TokenMeter
                cap={token}
                key={`${keyOf(token)}-tokens`}
              />
            ))}
        </Fragment>
      ))}
      {tokenCaps
        .filter(token => !paired.has(keyOf(token)))
        .map(token => (
          <TokenMeter
            cap={token}
            key={`${keyOf(token)}-tokens`}
          />
        ))}
      {tokenCaps.length === 0 ? null : (
        <p className={styles["note"]}>
          Tokens counted: input, output and cache write. Cache reads are not
          counted.
        </p>
      )}
      {limits.plan.map(limit => (
        <p
          className={styles["note"]}
          key={limit.window}
        >
          {`Your Claude plan's ${limit.window.replaceAll("_", " ")} limit ${limit.status === "rejected" ? "was reached" : "is close"}${limit.resetsAt === undefined ? "" : `; it resets ${when(limit.resetsAt)}`}.`}
        </p>
      ))}
    </section>
  );
};
