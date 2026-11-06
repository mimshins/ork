/**
 * @file An item's records in the Feedback panel, newest first: when, from whom,
 *   the signal's code for one of Ork's own, the run and the node, and the way
 *   to that run in the Monitor, named for the run, node and time; then the
 *   record's own title when it isn't the item's (one merged in), its words
 *   exactly as written, and its evidence.
 */

import type { FeedbackItem, FeedbackRecord } from "@krapht/ork-server/client";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { Unseen } from "../components/unseen.tsx";
import { short } from "./feedback-model.ts";
import { timeOf } from "./run-row.tsx";
import type { DetailRead } from "./use-feedback.ts";

import styles from "./feedback.module.css";

const metaOf = (record: FeedbackRecord): string =>
  [
    timeOf(record.at),
    record.feedback.source,
    ...(record.feedback.code === undefined ? [] : [record.feedback.code]),
    `run ${record.runId}`,
    ...(record.node === undefined ? [] : [record.node]),
  ].join(" · ");

const Record = ({
  record,
  title,
  onOpenRun,
}: {
  record: FeedbackRecord;
  /** The item's title: a record's own shows only when it differs. */
  title: string;
  onOpenRun: (run: string, node?: string) => void;
}) => {
  const { feedback, runId, node } = record;
  return (
    <li className={styles["record"]}>
      <p className={styles["recordMeta"]}>
        <span>{metaOf(record)}</span>
        <Button
          onClick={() => {
            onOpenRun(runId, node);
          }}
          variant="ghost"
        >
          Open run
          {/* Which run and when, so two records' buttons differ by name. */}
          <Unseen>
            {` ${runId}${node === undefined ? "" : ` at ${node}`}, ${timeOf(record.at)}`}
          </Unseen>
        </Button>
      </p>
      {feedback.title === title ? null : (
        <h4 className={styles["recordTitle"]}>{feedback.title}</h4>
      )}
      {feedback.body === "" ? null : (
        <p className={styles["recordBody"]}>{feedback.body}</p>
      )}
      {feedback.evidence.length === 0 ? null : (
        <p className={styles["evidence"]}>
          <span className={styles["caption"]}>Evidence </span>
          {feedback.evidence.join(", ")}
        </p>
      )}
    </li>
  );
};

export const ItemRecords = ({
  item,
  read,
  onOpenRun,
}: {
  item: FeedbackItem;
  read: DetailRead;
  onOpenRun: (run: string, node?: string) => void;
}) => {
  const id = short(item.id);
  const records = read.detail?.records;
  return (
    <div className={styles["section"]}>
      <h3 className={styles["caption"]}>
        {records === undefined
          ? "Records"
          : `Records · ${String(records.length)}, newest first`}
      </h3>
      {records === undefined && read.error !== null ? (
        <div className={styles["line"]}>
          <p
            className={styles["alert"]}
            role="alert"
          >
            <CodeText text={`Could not read the records: ${read.error}`} />
          </p>
          <Button
            onClick={read.reload}
            variant="ghost"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {records === undefined && read.error === null ? (
        <p
          aria-busy="true"
          className={styles["message"]}
        >
          Reading records…
        </p>
      ) : null}
      {records === undefined ? null : (
        <ol
          aria-label={`Records of ${id}, newest first`}
          className={styles["records"]}
          // WebKit drops a list's role when its markers are off.
          // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- see above
          role="list"
        >
          {records.toReversed().map(record => (
            <Record
              key={record.id}
              onOpenRun={onOpenRun}
              record={record}
              title={item.title}
            />
          ))}
        </ol>
      )}
    </div>
  );
};
