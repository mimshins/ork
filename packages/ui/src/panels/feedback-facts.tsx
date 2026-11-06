/**
 * @file An item's facts in the Feedback panel, as `ork feedback show` gives
 *   them: its id (copying the whole fingerprint), what it's about, its kind and
 *   severity, how often and when it was seen, the workflows, models and sources
 *   it came from, and the items triage merged into it, with the way to split
 *   them back out; a fix being proposed for it; and, in a narrow panel, the way
 *   back to the list.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";
import type { ReactNode } from "react";

import { Button } from "../components/button.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { IconArrowLeft, IconPlay } from "../components/icons.tsx";
import { Unseen } from "../components/unseen.tsx";
import { runsWords, short, timesWords } from "./feedback-model.ts";
import { timeOf } from "./run-row.tsx";

import styles from "./feedback.module.css";

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className={styles["fact"]}>
    <dt className={styles["factName"]}>{name}</dt>
    <dd className={styles["factValue"]}>{children}</dd>
  </div>
);

/** A list of names as one fact, or nothing when there are none. */
const Names = ({
  name,
  values,
}: {
  name: string;
  values: readonly string[];
}) =>
  values.length === 0 ? null : <Fact name={name}>{values.join(", ")}</Fact>;

export const ItemFacts = ({
  item,
  onSplit,
}: {
  item: FeedbackItem;
  onSplit: () => void;
}) => {
  const id = short(item.id);
  return (
    <dl className={styles["facts"]}>
      <Fact name="Item">
        {id}
        <CopyButton
          label={`Copy the id of ${id}`}
          text={item.id}
        />
      </Fact>
      <Fact name="About">{item.target}</Fact>
      <Fact name="Kind">{item.kind}</Fact>
      <Fact name="Severity">{item.severity}</Fact>
      <Fact name="Seen">
        <span>
          <span aria-hidden="true">{`${String(item.count)}×`}</span>
          <Unseen>{timesWords(item.count)}</Unseen>
          {` in ${runsWords(item.runs.length)}`}
        </span>
      </Fact>
      <Fact name="First seen">
        <time dateTime={item.firstSeen}>{timeOf(item.firstSeen)}</time>
      </Fact>
      <Fact name="Last seen">
        <time dateTime={item.lastSeen}>{timeOf(item.lastSeen)}</time>
      </Fact>
      <Names
        name="Workflows"
        values={item.workflows}
      />
      <Names
        name="Models"
        values={item.models}
      />
      <Names
        name="Sources"
        values={item.sources}
      />
      {item.merged.length === 0 ? null : (
        <Fact name="Merged">
          {item.merged.map(short).join(", ")}
          <Button
            cli={`ork feedback split ${id}`}
            onClick={onSplit}
            variant="ghost"
          >
            Split
          </Button>
        </Fact>
      )}
    </dl>
  );
};

export const BackToItems = ({ onBack }: { onBack: () => void }) => (
  <Button
    onClick={onBack}
    variant="ghost"
  >
    <IconArrowLeft />
    Back to items
  </Button>
);

export const FixLine = ({
  run,
  onOpen,
}: {
  run: string;
  onOpen: (run: string) => void;
}) => (
  <p className={styles["line"]}>
    <span className={styles["lineIcon"]}>
      <IconPlay />
    </span>
    <span className={styles["message"]}>
      Run <code>{run}</code> is proposing a fix.
    </span>
    <Button
      aria-label={`Open run ${run}`}
      onClick={() => {
        onOpen(run);
      }}
      variant="ghost"
    >
      Open run
    </Button>
  </p>
);
