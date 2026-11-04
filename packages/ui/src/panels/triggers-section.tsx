/**
 * @file What `ork watch` is doing (RFC-011), under the runs: which triggers are
 *   live, when each last looked, and what's in its way. It's for reading:
 *   accepting one takes a terminal, so a tab can't approve code to run with
 *   nobody there.
 */

import type { TriggersReport } from "@krapht/ork-server/client";
import { useEffect } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";

import styles from "./runs.module.css";

/** A trigger looks once a minute at most, so this is often enough. */
const REFRESH_MS = 30_000;

type Status = TriggersReport["triggers"][number];

const STANDING: Readonly<Record<Status["standing"], string>> = {
  live: "Live",
  new: "Off: new, not accepted yet",
  changed: "Off: changed since it was accepted",
  invalid: "Off: it has an error",
};

/** What to run about it, which a tab can't do. */
const NEXT: Readonly<Partial<Record<Status["standing"], string>>> = {
  new: "ork watch --accept",
  changed: "ork watch --accept",
  invalid: "ork validate",
};

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });

/** Each thing to say of a trigger, in order. */
export const triggerLines = (status: Status): string[] => [
  STANDING[status.standing],
  ...(status.lookedAt === undefined
    ? []
    : [`Last looked ${clock(status.lookedAt)}`]),
  ...(status.error === undefined ? [] : [`Last look failed: ${status.error}`]),
  ...(status.held === undefined ? [] : [`Waiting: ${status.held}`]),
];

export const TriggersSection = () => {
  const { triggers } = useAppState();
  const read = useValue(triggers.state);
  useEffect(() => {
    void triggers.load();
    const timer = setInterval(() => {
      void triggers.load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [triggers]);
  const report = shownOf(read)?.data;
  if (report === undefined || report.triggers.length === 0) return null;
  return (
    <section
      aria-label="Triggers"
      className={styles["triggers"]}
    >
      <h3 className={styles["triggersTitle"]}>Triggers</h3>
      {report.pid === undefined ? (
        <p className={styles["note"]}>
          ork watch isn&apos;t running, so nothing is looking.
        </p>
      ) : null}
      <ul className={styles["triggerList"]}>
        {report.triggers.map(status => (
          <li key={`${status.project}/${status.trigger}`}>
            <span className={styles["triggerName"]}>{status.trigger}</span>
            {` starts ${status.run}, every ${status.every}`}
            {triggerLines(status).map(line => (
              <span
                className={styles["triggerLine"]}
                key={line}
              >
                {line}
              </span>
            ))}
            {NEXT[status.standing] === undefined ? null : (
              <code className={styles["triggerCommand"]}>
                {NEXT[status.standing]}
              </code>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
