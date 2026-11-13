/**
 * @file The list routes' query schemas name the fields of core's tables (the
 *   contract cannot import them at run time, so this test holds them equal),
 *   and take them as text.
 */

import { LIST_TABLES } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import {
  DecisionsQuerySchema,
  FeedbackItemsQuerySchema,
  FollowUpsQuerySchema,
  LIST_FIELD_NAMES,
  RunsQuerySchema,
  UsageQuerySchema,
  WorktreesQuerySchema,
} from "../src/browser.ts";
import { listFields } from "../src/list-fields-routes.ts";

/** Each list: its schema, its core table's field names, and its names here. */
const LISTS = [
  ["runs", RunsQuerySchema, LIST_TABLES.ps, LIST_FIELD_NAMES.runs],
  [
    "feedback",
    FeedbackItemsQuerySchema,
    LIST_TABLES["feedback list"],
    LIST_FIELD_NAMES.feedback,
  ],
  [
    "follow-ups",
    FollowUpsQuerySchema,
    LIST_TABLES["follow-ups list"],
    LIST_FIELD_NAMES["follow-ups"],
  ],
  [
    "decisions",
    DecisionsQuerySchema,
    LIST_TABLES["decide --list"],
    LIST_FIELD_NAMES.decisions,
  ],
  [
    "worktrees",
    WorktreesQuerySchema,
    LIST_TABLES["worktrees list"],
    LIST_FIELD_NAMES.worktrees,
  ],
  ["usage", UsageQuerySchema, LIST_TABLES.usage, LIST_FIELD_NAMES.usage],
] as const;

/** A value of a field's type: a time, or any text. */
const sample = (type: string): string =>
  type === "since" || type === "until" ? "24h" : "x";

describe("list query schemas", () => {
  it.each(LISTS)("%s names its core table's fields", (_, __, table, names) => {
    expect(names).toEqual(table.fields.map(field => field.name));
  });

  it.each(LISTS)("%s takes every field", (_, schema, table) => {
    const query = Object.fromEntries(
      table.fields.map(field => [field.name, sample(field.type)]),
    );
    expect(schema.parse(query)).toEqual(query);
  });

  it("keeps runs' limit and refuses an unknown param", () => {
    expect(RunsQuerySchema.parse({ limit: "5" })).toEqual({ limit: 5 });
    expect(RunsQuerySchema.safeParse({ nope: "x" }).success).toBe(false);
  });
});

describe("GET /api/list-fields", () => {
  it("serves each list's core table fields, without functions", () => {
    const answer = listFields();
    expect(JSON.parse(JSON.stringify(answer))).toEqual(answer);
    for (const [list, , table] of LISTS) {
      expect(answer[list].map(field => field.name)).toEqual(
        table.fields.map(field => field.name),
      );
    }
  });
});
