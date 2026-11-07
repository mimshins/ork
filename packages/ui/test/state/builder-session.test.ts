/**
 * @file Tests for the Builder's session in the page's state: opening a workflow
 *   and selecting a card tell the Context panel, showing the same workflow
 *   afresh only asks it to plan again, closing leaves it with nothing, and
 *   changes wait their turn whichever panel sent them.
 */

import { describe, expect, it } from "vitest";

import { createContextTarget } from "../../src/state/context-target.ts";
import { reviewView } from "../panels/context-harness.tsx";

const session = () => {
  const context = createContextTarget();
  return { context, builder: context.builder };
};

const REVIEW = { project: "p", name: "review" };

describe("the Builder's session", () => {
  it("tells the Context panel what opens and what's selected", () => {
    const { context, builder } = session();
    builder.show(REVIEW, reviewView(true));
    expect(context.target.getValue()).toMatchObject({
      kind: "builder",
      workflow: "review",
      node: null,
      draft: true,
    });
    builder.select("fix");
    expect(context.target.getValue()).toMatchObject({ node: "fix" });
  });

  it("keeps the Context panel's node when the same workflow shows afresh", () => {
    const { context, builder } = session();
    builder.show(REVIEW, reviewView(true));
    builder.select("fix");
    builder.show(REVIEW, reviewView(false));
    expect(builder.selected.getValue()).toBeNull();
    expect(context.target.getValue()).toMatchObject({
      node: "fix",
      draft: false,
    });
  });

  it("asks the Context panel to plan again on each answer", () => {
    const { context, builder } = session();
    builder.show(REVIEW, reviewView(true));
    expect(context.target.getValue()).toMatchObject({ revision: 1 });
    builder.update(reviewView(true));
    expect(context.target.getValue()).toMatchObject({ revision: 2 });
  });

  it("leaves the Context panel with nothing when it closes", () => {
    const { context, builder } = session();
    builder.show(REVIEW, reviewView(true));
    builder.show(null, null);
    expect(context.target.getValue()).toBeNull();
  });

  it("runs each change after the one before it", async () => {
    const { builder } = session();
    const order: string[] = [];
    const slow = builder.inTurn(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 20);
      });
      order.push("first");
    });
    const quick = builder.inTurn(() => {
      order.push("second");
      return Promise.resolve();
    });
    await Promise.all([slow, quick]);
    expect(order).toEqual(["first", "second"]);
  });
});
