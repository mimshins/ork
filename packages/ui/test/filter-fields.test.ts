/**
 * @file Holds the UI tests' copy of the filter fields (`filter-fields.ts`) to
 *   the server's real answer for `GET /api/list-fields`: an entry that drifts
 *   from the core tables fails here, not silently in a bar under test.
 */

import { listFields } from "@krapht/ork-server";
import { describe, expect, it } from "vitest";

import { LIST_FIELDS } from "./filter-fields.ts";

const real = listFields();

describe("the filter-fields fixture", () => {
  it("has the server's lists, and no others", () => {
    expect(Object.keys(LIST_FIELDS).toSorted()).toEqual(
      Object.keys(real).toSorted(),
    );
  });

  it.each(Object.entries(real))(
    "%s lists the server's fields, word for word",
    (list, fields) => {
      expect(Object.entries(LIST_FIELDS)).toContainEqual([list, fields]);
    },
  );
});
