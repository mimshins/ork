/**
 * @file `GET /api/list-fields`: the filter fields of each list, from core's
 *   tables (RFC-017), as text without their functions, so the UI builds its
 *   filter bar without importing core.
 */

import { LIST_TABLES, type ListField } from "@krapht/ork-core";

import type { ListFieldInfo, ListFieldsAnswer } from "./contract-lists.ts";
import { type Handlers, ok } from "./router.ts";

const infoOf = <Row>(field: ListField<Row>): ListFieldInfo => ({
  name: field.name,
  description: field.description,
  type: field.type,
  ...(field.values === undefined ? {} : { values: [...field.values] }),
  ...(field.all === true ? { all: true as const } : {}),
});

/** The answer, built once: the tables do not change while the server runs. */
export const listFields = (): ListFieldsAnswer => ({
  runs: LIST_TABLES.ps.fields.map(infoOf),
  feedback: LIST_TABLES["feedback list"].fields.map(infoOf),
  "follow-ups": LIST_TABLES["follow-ups list"].fields.map(infoOf),
  decisions: LIST_TABLES["decide --list"].fields.map(infoOf),
  worktrees: LIST_TABLES["worktrees list"].fields.map(infoOf),
  usage: LIST_TABLES.usage.fields.map(infoOf),
});

export const listFieldsRoutes = (): Pick<Handlers, "listFields"> => ({
  listFields: () => ok(listFields()),
});
