/**
 * @file The whole story of one end: the badge and Ork's sentence, what to do,
 *   who acts, the guide's section on the kind, and the Details. It is in a
 *   node's strip in the Monitor and in an opened `node.finished` row of the
 *   Logs panel. The message is Ork's; the provider's own words are only in
 *   Details.
 */

import type { EndView } from "@krapht/ork-server/client";

import { CodeText } from "./code-text.tsx";
import { EndBadge } from "./end-badge.tsx";
import { EndDetails } from "./end-details.tsx";
import { IconExternal } from "./icons.tsx";
import { Unseen } from "./unseen.tsx";

import styles from "./end-note.module.css";

/** The guide that lists every kind, on the project's public repository. */
const GUIDE =
  "https://github.com/mimshins/ork/blob/main/docs/guides/why-a-node-stopped.md";

const WHO: Record<NonNullable<EndView["actor"]>, string> = {
  agent: "the agent",
  workflow: "the workflow",
  account: "your account",
  provider: "the provider",
  user: "you",
  ork: "Ork",
};

/** The sentence ends with a full stop, whether or not the message has one. */
const sentence = (message: string): string =>
  message.endsWith(".") ? message : `${message}.`;

export const EndNote = ({
  node,
  end,
  runId,
}: {
  node: string;
  end: EndView;
  runId: string;
}) =>
  end.actor === null ? null : (
    <div
      aria-label={`How ${node} ended`}
      className={styles["note"]}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a named set of related text, not a form's fieldset
      role="group"
    >
      <p className={styles["message"]}>
        <EndBadge
          end={end}
          pill
        />
        <span>
          <code>{node}</code> <CodeText text={sentence(end.message)} />
        </span>
      </p>
      {end.hint === "" ? null : (
        <p className={styles["hint"]}>
          <CodeText text={end.hint} />
        </p>
      )}
      <div className={styles["facts"]}>
        <dl className={styles["who"]}>
          <dt>Who acts</dt>
          <dd>{WHO[end.actor]}</dd>
        </dl>
        <a
          className={styles["guide"]}
          href={`${GUIDE}#${end.docsAnchor}`}
          rel="noreferrer"
          target="_blank"
        >
          Why a node stops
          <IconExternal />
          <Unseen>{` — what ${end.label} means (opens the guide in a new tab)`}</Unseen>
        </a>
      </div>
      <EndDetails
        cli={`ork logs ${runId} --node ${node}`}
        detail={end.detail}
        node={node}
      />
    </div>
  );
