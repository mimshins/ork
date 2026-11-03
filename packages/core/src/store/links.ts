/**
 * @file The store's links: which nodes of live runs may write to each other
 *   (RFC-003). Any process can read them, which is what lets a sender's run
 *   check a link without asking the other run.
 */

import type { DatabaseSync } from "node:sqlite";

import { type Row, text } from "./schema.ts";
import type { LinkRecord, LinkStore } from "./types.ts";

const linkOf = (row: Row): LinkRecord => {
  const ended = text(row, "ended_at");
  return {
    id: Number(row?.["id"]),
    a: { run: text(row, "a_run"), node: text(row, "a_node") },
    b: { run: text(row, "b_run"), node: text(row, "b_node") },
    messages: Number(row?.["messages"]),
    maxMessages: Number(row?.["max_messages"]),
    createdAt: text(row, "created_at"),
    ...(ended === "" ? {} : { endedAt: ended }),
  };
};

export const linkQueries = (db: DatabaseSync): LinkStore => {
  const insert = db.prepare(
    `INSERT INTO links (a_run, a_node, b_run, b_node, max_messages, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const byId = db.prepare("SELECT * FROM links WHERE id = ?");
  const filtered = db.prepare(
    `SELECT * FROM links
     WHERE (?1 IS NULL OR a_run = ?1 OR b_run = ?1)
       AND (?2 = 0 OR ended_at IS NULL)
     ORDER BY id`,
  );
  const count = db.prepare(
    "UPDATE links SET messages = messages + 1 WHERE id = ?",
  );
  const extend = db.prepare(
    "UPDATE links SET max_messages = max_messages + ? WHERE id = ?",
  );
  const end = db.prepare(
    "UPDATE links SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
  );

  const link: LinkStore["link"] = id => {
    const row = byId.get(id);
    return row === undefined ? undefined : linkOf(row);
  };

  return {
    addLink: (a, b, maxMessages) => {
      const { lastInsertRowid } = insert.run(
        a.run,
        a.node,
        b.run,
        b.node,
        maxMessages,
        new Date().toISOString(),
      );
      return linkOf(byId.get(lastInsertRowid));
    },
    link,
    links: (filter = {}) =>
      filtered
        .all(filter.run ?? null, filter.live === true ? 1 : 0)
        .map(row => linkOf(row)),
    countMessage: id => {
      count.run(id);
    },
    extendLink: (id, by) => {
      extend.run(by, id);
    },
    endLink: id => end.run(new Date().toISOString(), id).changes > 0,
  };
};
