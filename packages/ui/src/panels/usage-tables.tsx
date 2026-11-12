/**
 * @file The Usage panel's numbers: the totals across its top, a table of where
 *   the spend went by one dimension, and what it says when it cannot read
 *   them.
 */

import type { LimitsReport, UsageReport } from "@krapht/ork-server/client";
import type { ReactNode } from "react";

import { EmptyState } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { CountedTerm, Dollars, PromptTerm } from "../components/spend.tsx";
import { UsageLimits } from "./usage-limits.tsx";
import { isAllTime, money, moneyOf, percent, tokens } from "./usage-model.ts";

import styles from "./usage.module.css";

type Group = UsageReport["groups"]["workflow"][number];

/** How many rows a breakdown shows before it says how many more there are. */
const MOST_ROWS = 10;

export const Breakdown = ({
  title,
  label,
  groups,
  total,
  nameOf,
  moreCommand,
}: {
  title: string;
  label: string;
  groups: readonly Group[];
  total: number;
  /** What a group's key reads as; the key itself is then shown beneath it. */
  nameOf?: (key: string) => string;
  /** The command that lists every row, for when they do not all fit. */
  moreCommand: string;
}) => {
  const more = groups.length - MOST_ROWS;
  const shown = groups.slice(0, MOST_ROWS);
  const cost = moneyOf(shown.map(group => group.costUsd));
  const withTokens = shown.some(group => (group.tokens ?? 0) > 0);
  return (
    <section
      aria-label={title}
      className={styles["section"]}
    >
      <h3 className={styles["heading"]}>{title}</h3>
      <table className={styles["table"]}>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Cost
            </th>
            {withTokens ? (
              <th
                className={styles["number"]}
                scope="col"
              >
                Tokens
              </th>
            ) : null}
            <th
              className={styles["number"]}
              scope="col"
            >
              Share
            </th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Sessions
            </th>
            <th
              className={styles["number"]}
              scope="col"
            >
              From cache
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map(group => (
            <tr key={group.key}>
              <th
                className={styles["name"]}
                scope="row"
                title={group.key}
              >
                {nameOf?.(group.key) ?? group.key}
                {nameOf === undefined ? null : (
                  <span className={styles["path"]}>{group.key}</span>
                )}
              </th>
              <td className={styles["number"]}>
                <Dollars
                  partial={group.partial === true}
                  text={cost(group.costUsd)}
                />
              </td>
              {withTokens ? (
                <td className={styles["number"]}>
                  {tokens(group.tokens ?? 0)}
                </td>
              ) : null}
              <td className={styles["number"]}>
                {percent(total === 0 ? 0 : group.costUsd / total)}
              </td>
              <td className={styles["number"]}>{group.sessions}</td>
              <td className={styles["number"]}>
                {percent(group.cacheHitRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? (
        <>
          <p className={styles["note"]}>
            And {more} more that cost less. This lists them all:
          </p>
          <CopyCommand command={moreCommand} />
        </>
      ) : null}
    </section>
  );
};

export const Refused = ({
  error,
  command,
  retry,
}: {
  error: string;
  command: string;
  retry: () => void;
}) => (
  <div className={styles["section"]}>
    <p
      className={styles["refused"]}
      role="alert"
    >
      Cannot read usage: <CodeText text={error} />
    </p>
    <div className={styles["retry"]}>
      <Button onClick={retry}>Try again</Button>
    </div>
    <p className={styles["note"]}>On a terminal, the same report:</p>
    <CopyCommand command={command} />
  </div>
);

export const NothingSpent = ({
  period,
  limits,
}: {
  period: string;
  limits: LimitsReport;
}) => (
  <>
    <UsageLimits limits={limits} />
    <EmptyState
      cli="ork run <workflow>"
      title={
        isAllTime(period)
          ? "Nothing spent yet."
          : "Nothing spent in this period."
      }
    >
      Claude sessions show here once they finish. Start one with Run workflow,
      or in a terminal:
    </EmptyState>
  </>
);

export const Totals = ({ report }: { report: UsageReport }) => {
  const { totals } = report;
  const read =
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const items: readonly (readonly [string, ReactNode])[] = [
    [
      "Spend",
      <Dollars
        focusable
        key="spend"
        partial={totals.partial === true}
        text={money(totals.costUsd)}
      />,
    ],
    ["Runs with sessions", String(totals.runs)],
    ["Sessions", String(totals.sessions)],
    ["Prompt tokens", tokens(read)],
    ["Output tokens", tokens(totals.outputTokens)],
    ["From cache", percent(totals.cacheHitRate)],
    ...(totals.tokens === undefined || totals.tokens === 0
      ? []
      : ([["Tokens counted", tokens(totals.tokens)]] as const)),
  ];
  return (
    <dl className={styles["totals"]}>
      {items.map(([term, value]) => (
        <div
          className={styles["total"]}
          key={term}
        >
          <dt>
            {term === "Tokens counted" ? (
              <CountedTerm />
            ) : term === "Prompt tokens" ? (
              <PromptTerm />
            ) : (
              term
            )}
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};
