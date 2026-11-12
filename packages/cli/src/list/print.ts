/**
 * @file How a list command prints its rows (RFC-017): `--ids` as `id,id,id` on
 *   one line (nothing for no rows), `--json`, or the command's own lines.
 */

import type { ListTable } from "@krapht/ork-core";

import { write } from "../output.ts";
import { refuseIdsWithJson } from "./flags.ts";

/**
 * Prints `rows`: `--ids` their ids (`table.id`) comma-separated; `--json` the
 * rows (or `json(rows)`); else `human(rows)`, which also says what an empty
 * list is. `--ids` with `--json` is refused (said, exit code set).
 */
export const printList = <Row>(
  rows: readonly Row[],
  table: ListTable<Row>,
  args: { ids?: unknown; json?: unknown },
  human: (shown: readonly Row[]) => void,
  json: (shown: readonly Row[]) => unknown = shown => shown,
): void => {
  if (refuseIdsWithJson(args)) return;
  if (args.ids === true) {
    const id = table.id;
    if (id !== undefined && rows.length > 0)
      write(rows.map(row => id(row)).join(","));
    return;
  }
  if (args.json === true) write(JSON.stringify(json(rows), undefined, 2));
  else human(rows);
};
