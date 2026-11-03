/** @file The Monitor's list of a run's links to nodes of other runs (RFC-003). */

import type { LinkRecord } from "@krapht/ork-server/client";

import { Button } from "../components/button.tsx";

import styles from "./monitor.module.css";

export const RunLinks = ({
  links,
  runId,
  onOpen,
}: {
  links: readonly LinkRecord[];
  runId: string;
  onOpen: (run: string) => void;
}) =>
  links.length === 0 ? null : (
    <section
      aria-label="Links to other runs"
      className={styles["links"]}
    >
      <h3 className={styles["sideTitle"]}>Links</h3>
      <ul className={styles["linkList"]}>
        {links.map(link => {
          const [own, peer] =
            link.a.run === runId ? [link.a, link.b] : [link.b, link.a];
          return (
            <li
              className={styles["link"]}
              key={link.id}
            >
              <span className={styles["linkEnds"]}>
                {own.node} ↔ {peer.run}/{peer.node}
              </span>
              <span className={styles["linkCount"]}>
                {link.messages}/{link.maxMessages}
                {link.endedAt === undefined ? "" : " · ended"}
              </span>
              <Button
                onClick={() => {
                  onOpen(peer.run);
                }}
                variant="ghost"
              >
                Open
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
