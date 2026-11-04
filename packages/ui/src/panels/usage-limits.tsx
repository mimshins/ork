/**
 * @file The limits across runs on the Usage panel (RFC-007): what each cap has
 *   left and when it resets, and any plan limit in force.
 */

import type { LimitsReport } from "@krapht/ork-server/client";

import { Meter } from "../components/meter.tsx";

import styles from "./usage.module.css";

const WHOSE = (project: string | undefined): string =>
  project === undefined ? "All projects" : "This project";

const usd = (amount: number): string => `$${amount.toFixed(2)}`;

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const UsageLimits = ({ limits }: { limits: LimitsReport }) =>
  limits.problems.length === 0 &&
  limits.caps.length === 0 &&
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
          {problem}
        </p>
      ))}
      {limits.caps.map(cap => (
        <Meter
          key={`${cap.project ?? "all"}-${cap.window}`}
          label={`${WHOSE(cap.project)}, this ${cap.window}`}
          max={cap.capUsd}
          text={`${usd(cap.spentUsd)} of ${usd(cap.capUsd)}, resets ${when(cap.resetsAt)}`}
          value={Math.min(cap.spentUsd, cap.capUsd)}
        />
      ))}
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
