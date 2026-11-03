/**
 * @file One node's conversation. It is a log, so a screen reader hears what is
 *   added, and it stays on the newest unless the reader has scrolled up. Whose
 *   words they are is said in words, not by position or color.
 */

import { memo, useLayoutEffect, useRef } from "react";

import type { ThreadItem } from "./chats-model.ts";
import { timeOf } from "./logs-model.ts";

import styles from "./chats.module.css";

const NEAR_END = 32;

const speaker = ({ kind, from }: ThreadItem, node: string): string => {
  if (kind === "you") return "You";
  return kind === "node" ? node : (from ?? "");
};

const Item = memo(({ item, node }: { item: ThreadItem; node: string }) =>
  item.kind === "activity" ? (
    <li className={styles["activity"]}>
      <span className={styles["activityText"]}>{item.text}</span>
      <span className={styles["time"]}>{timeOf(item.at)}</span>
    </li>
  ) : (
    <li
      className={styles["message"]}
      data-kind={item.kind}
    >
      <p className={styles["meta"]}>
        <span className={styles["speaker"]}>{speaker(item, node)}</span>
        <span className={styles["time"]}>{timeOf(item.at)}</span>
        {item.note === undefined ? null : (
          <span className={styles["note"]}>{item.note}</span>
        )}
      </p>
      <p className={styles["text"]}>{item.text}</p>
    </li>
  ),
);
Item.displayName = "ThreadRow";

export const ChatThread = ({
  items,
  node,
}: {
  items: readonly ThreadItem[];
  node: string;
}) => {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && pinned.current) {
      element.scrollTop = element.scrollHeight;
    }
  });

  return (
    <div
      aria-label={`Conversation with ${node}`}
      className={styles["thread"]}
      onScroll={event => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        pinned.current = scrollHeight - scrollTop - clientHeight < NEAR_END;
      }}
      ref={list}
      role="log"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys scroll it
      tabIndex={0}
    >
      <ol className={styles["items"]}>
        {items.map(item => (
          <Item
            item={item}
            key={item.seq}
            node={node}
          />
        ))}
      </ol>
    </div>
  );
};
