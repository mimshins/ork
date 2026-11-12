/**
 * @file A follow-up's facts in the Follow-ups panel, as `ork follow-ups show`
 *   gives them: its id with a copy of it, who it is for, kind, due, status, ref
 *   as a link, the run it came from with Open run, files, where it is kept,
 *   where one for another project went, and when it was added and changed; and,
 *   in a narrow panel, the way back to the list.
 */

import type { FollowUpDetail } from "@krapht/ork-server/client";
import type { ReactNode } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { IconArrowLeft, IconExternal } from "../components/icons.tsx";
import { type FollowUpRow, isSent, short } from "./followups-model.ts";
import { timeOf } from "./run-row.tsx";

import styles from "./followups.module.css";

export const BackToFollowUps = ({ onBack }: { onBack: () => void }) => (
  <Button
    onClick={onBack}
    variant="ghost"
  >
    <IconArrowLeft />
    Back to follow-ups
  </Button>
);

export const Fact = ({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) => (
  <div className={styles["fact"]}>
    <dt className={styles["factName"]}>{name}</dt>
    <dd className={styles["factValue"]}>{children}</dd>
  </div>
);

const placeWords = (d: FollowUpDetail): string => {
  const { place, url } = d.keptIn;
  if (place === "store") return "Ork's store";
  return url ?? (place === "file" ? ".ork/follow-ups.md" : "GitHub");
};

const deliveryWords = (
  d: FollowUpDetail,
  registered: readonly string[],
): string | undefined => {
  const { delivery } = d;
  if (delivery === undefined) return undefined;
  if (!delivery.registered) {
    return `Not delivered: \`${delivery.project}\` isn't registered. Registered: ${registered.map(name => `\`${name}\``).join(", ") || "none"}.`;
  }
  return delivery.live === undefined
    ? `In \`${delivery.project}\`'s list`
    : `Sent to its live run \`${short(delivery.live.run)}\` through relay`;
};

export const Facts = ({
  row,
  detail,
  projects,
  onOpenRun,
}: {
  row: FollowUpRow;
  detail: FollowUpDetail | null;
  /** The registered projects, named when one a follow-up is for is not. */
  projects: readonly string[];
  onOpenRun: (run: string, node?: string) => void;
}) => {
  const delivery =
    detail === null ? undefined : deliveryWords(detail, projects);
  return (
    <dl className={styles["facts"]}>
      <Fact name="Id">
        {short(row.id)}
        <CopyButton
          label="Copy id"
          text={row.id}
        />
      </Fact>
      <Fact name="For">{row.for}</Fact>
      <Fact name="Kind">{row.kind}</Fact>
      <Fact name="Due">{row.due}</Fact>
      <Fact name="Status">{isSent(row) ? "sent" : row.status}</Fact>
      {row.ref === undefined ? null : (
        <Fact name="Ref">
          {/^https?:\/\//u.test(row.ref) ? (
            <a
              className={styles["link"]}
              href={row.ref}
              rel="noreferrer"
              target="_blank"
            >
              {row.ref}
              <IconExternal />
            </a>
          ) : (
            row.ref
          )}
        </Fact>
      )}
      {row.from.run === undefined ? null : (
        <Fact name="From">
          {`run ${short(row.from.run)}${row.from.node === undefined ? "" : `, node ${row.from.node}`}`}
          <Button
            aria-label={`Open run ${short(row.from.run)}${row.from.node === undefined ? "" : `, node ${row.from.node}`}`}
            onClick={() => {
              if (row.from.run !== undefined) {
                onOpenRun(row.from.run, row.from.node);
              }
            }}
            variant="ghost"
          >
            Open run
          </Button>
        </Fact>
      )}
      {row.where.length === 0 ? null : (
        <Fact name="Where">{row.where.join(", ")}</Fact>
      )}
      {detail === null ? null : (
        <Fact name="Kept in">
          {placeWords(detail)}
          {detail.keptIn.fallback === undefined ? null : (
            <span className={styles["note"]}>{detail.keptIn.fallback}</span>
          )}
        </Fact>
      )}
      {delivery === undefined ? null : (
        <Fact name="Delivery">
          <CodeText text={delivery} />
        </Fact>
      )}
      <Fact name="Added">
        <time dateTime={row.createdAt}>{timeOf(row.createdAt)}</time>
      </Fact>
      <Fact name="Last changed">
        <time dateTime={row.updatedAt}>{timeOf(row.updatedAt)}</time>
      </Fact>
    </dl>
  );
};
