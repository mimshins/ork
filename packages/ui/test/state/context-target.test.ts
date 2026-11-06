/**
 * @file Tests for which node the Context panel shows: the latest chosen, a
 *   run's or the Builder's. A change in the Builder asks again only while the
 *   panel shows that workflow, a new workflow starts its revisions afresh, and
 *   closing the Builder clears only what it chose.
 */

import { describe, expect, it } from "vitest";

import { createContextTarget } from "../../src/state/context-target.ts";

const FIX = { project: "p", workflow: "review", node: "fix", draft: true };

describe("the Context panel's target", () => {
  it("is the latest choice, a run's or the Builder's", () => {
    const context = createContextTarget();
    context.chooseBuilder(FIX);
    context.chooseRun("aaa11111", "lead");
    expect(context.target.getValue()).toEqual({
      kind: "run",
      run: "aaa11111",
      node: "lead",
    });
    context.chooseRun(null, null);
    expect(context.target.getValue()).toBeNull();
  });

  it("asks again on a Builder change only while it shows that workflow", () => {
    const context = createContextTarget();
    context.chooseBuilder(FIX);
    context.builderChanged("p", "review", false);
    expect(context.target.getValue()).toMatchObject({
      revision: 1,
      draft: false,
    });
    context.builderChanged("p", "other", true);
    expect(context.target.getValue()).toMatchObject({ revision: 1 });
    context.chooseRun("aaa11111", "lead");
    context.builderChanged("p", "review", true);
    expect(context.target.getValue()).toMatchObject({ kind: "run" });
  });

  it("keeps a workflow's revisions across its cards, and starts a new one's at 0", () => {
    const context = createContextTarget();
    context.chooseBuilder(FIX);
    context.builderChanged("p", "review", true);
    context.chooseBuilder({ ...FIX, node: "lead" });
    expect(context.target.getValue()).toMatchObject({ revision: 1 });
    context.chooseBuilder({ ...FIX, workflow: "other" });
    expect(context.target.getValue()).toMatchObject({ revision: 0 });
  });

  it("is cleared by the Builder closing only when the Builder chose it", () => {
    const context = createContextTarget();
    context.chooseRun("aaa11111", "lead");
    context.builderClosed();
    expect(context.target.getValue()).toMatchObject({ kind: "run" });
    context.chooseBuilder(FIX);
    context.builderClosed();
    expect(context.target.getValue()).toBeNull();
  });
});
