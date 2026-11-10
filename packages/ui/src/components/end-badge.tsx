/**
 * @file The end badge: how a node ended, in a glyph and the kind's own word
 *   (`StatusBadge` with that word), toned by who can act, so what the reader
 *   can do about it shows and the actor is always written out too. A kind that
 *   may pass says so in words, never in color. A node that finished well has
 *   none. The UI branches on the actor and `transient`, never on the kind, so a
 *   kind added later needs no change here.
 */

import type { EndView } from "@krapht/ork-server/client";

import { StatusBadge, type Status } from "./status-badge.tsx";
import { Unseen } from "./unseen.tsx";

import styles from "./end-badge.module.css";

type Actor = NonNullable<EndView["actor"]>;

const STATUS: Record<Actor, Status> = {
  agent: "failed",
  workflow: "failed",
  ork: "failed",
  // Needs the person: amber, like a question.
  account: "waiting",
  provider: "interrupted",
  user: "interrupted",
};

/** The tone an actor's ends take. */
export const endStatusOf = (actor: Actor): Status => STATUS[actor];

export const EndBadge = ({
  end,
  pill = false,
}: {
  end: EndView;
  /** Tints it, for the end that heads a view. */
  pill?: boolean;
}) =>
  end.actor === null ? null : (
    <span className={styles["end"]}>
      <StatusBadge
        pill={pill}
        status={endStatusOf(end.actor)}
        word={end.label}
      />
      {end.transient ? (
        <>
          <span aria-hidden="true">·</span>
          <Unseen>, </Unseen>
          <span
            className={styles["note"]}
            data-transient
          >
            may pass
          </span>
        </>
      ) : null}
    </span>
  );
