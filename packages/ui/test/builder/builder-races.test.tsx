/**
 * @file Tests for the builder's state when a person is quicker than the server:
 *   an answer about a workflow that's no longer open changes nothing on screen,
 *   and each change builds on what it follows rather than on the last render.
 */

import type { WorkflowEdit } from "@krapht/ork-server/client";
import { act, cleanup, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Builder, useBuilder } from "../../src/builder/use-builder.ts";
import { stubWindow } from "../dom.ts";
import {
  openPanelState,
  project,
  renderPanel,
  workflowNamed,
} from "../panels/harness.tsx";
import { fakeWorkflows } from "./fake-workflows.ts";

const mount = () => {
  const fake = fakeWorkflows();
  const opened = openPanelState({
    projects: [project("shop"), project("other")],
    workflows: { shop: [workflowNamed("a"), workflowNamed("b")] },
    builder: fake.routes,
  });
  const held: { builder: Builder | null } = { builder: null };
  const Probe = () => {
    const builder = useBuilder();
    useLayoutEffect(() => {
      held.builder = builder;
    });
    return null;
  };
  renderPanel(opened.state, <Probe />);
  const builder = (): Builder => {
    if (held.builder === null) throw new Error("Not drawn yet.");
    return held.builder;
  };
  return { ...fake, builder };
};

const shownText = (builder: () => Builder): string =>
  builder().view?.text ?? "";

const describing = (value: string): WorkflowEdit => ({
  op: "set",
  path: ["description"],
  value,
});

const settle = (ms: number) =>
  act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("after a save", () => {
  it("shows an edit made right after it, as unsaved", async () => {
    const { builder, holds, files } = mount();
    await act(() => builder().open("shop", "a"));
    await act(() => builder().edit(describing("one")));
    holds.push({ match: route => route.endsWith("/builder/a"), ms: 40 });
    await act(async () => {
      await Promise.all([builder().save(), builder().edit(describing("two"))]);
    });
    await settle(80);
    expect(files["a"]?.text).toContain("description: two");
    expect(shownText(builder)).toContain("description: two");
    expect(builder().view?.draft).toBe(true);
  });

  it("doesn't show the old workflow over one opened right after it", async () => {
    const { builder, holds } = mount();
    await act(() => builder().open("shop", "a"));
    await act(() => builder().edit(describing("one")));
    holds.push({ match: route => route.endsWith("/builder/a"), ms: 40 });
    await act(async () => {
      await Promise.all([builder().save(), builder().open("shop", "b")]);
    });
    await settle(80);
    expect(builder().opened?.name).toBe("b");
    expect(builder().view?.name).toBe("b");
  });

  it("can't undo past it", async () => {
    const { builder } = mount();
    await act(() => builder().open("shop", "a"));
    await act(() => builder().edit(describing("one")));
    expect(builder().canUndo).toBe(true);
    await act(() => builder().save());
    expect(builder().canUndo).toBe(false);
  });
});

describe("an edit from before another workflow opened", () => {
  it("goes to its own workflow, and isn't shown over the new one", async () => {
    const { builder, holds, files } = mount();
    await act(() => builder().open("shop", "a"));
    const { edit } = builder();
    holds.push({ match: route => route.endsWith("/builder/b"), ms: 20 });
    await act(async () => {
      await Promise.all([
        builder().open("shop", "b"),
        edit(describing("late")),
      ]);
    });
    await settle(40);
    expect(files["a"]?.text).toContain("description: late");
    expect(files["b"]?.text).not.toContain("late");
    expect(builder().view?.name).toBe("b");
    expect(builder().canUndo).toBe(false);
  });
});

describe("undo", () => {
  it("goes back one step each time, however quickly", async () => {
    const { builder } = mount();
    await act(() => builder().open("shop", "a"));
    const start = shownText(builder);
    await act(() => builder().edit(describing("one")));
    await act(() => builder().edit(describing("two")));
    const { undo } = builder();
    await act(async () => {
      await Promise.all([undo(), undo()]);
    });
    expect(shownText(builder)).toBe(start);
    expect(builder().canUndo).toBe(false);
  });

  it("takes back an edit still on its way", async () => {
    const { builder, holds } = mount();
    await act(() => builder().open("shop", "a"));
    const start = shownText(builder);
    await act(() => builder().edit(describing("one")));
    const one = shownText(builder);
    holds.push({ match: route => route.endsWith("/edits"), ms: 20 });
    await act(async () => {
      await Promise.all([builder().edit(describing("two")), builder().undo()]);
    });
    expect(shownText(builder)).toBe(one);
    await act(() => builder().undo());
    expect(shownText(builder)).toBe(start);
  });
});

const keepOrNew = (current: unknown): unknown => current ?? "new";

describe("a change to a list", () => {
  const PATH = ["nodes", "n", "plainEnv"];

  it("builds on what was just sent, not on the last render", async () => {
    const { builder, holds, files } = mount();
    await act(() => builder().open("shop", "a"));
    await act(() => builder().change(PATH, () => ({ A: "" })));
    holds.push({ match: route => route.endsWith("/edits"), ms: 20 });
    await act(async () => {
      await Promise.all([
        builder().change([...PATH, "A"], () => "typed"),
        builder().change([...PATH, "B"], keepOrNew),
      ]);
    });
    expect(files["a"]?.text).toContain("A: typed");
    expect(files["a"]?.text).toContain("B: new");
  });

  it("sends nothing when nothing changes", async () => {
    const { builder, log } = mount();
    await act(() => builder().open("shop", "a"));
    await act(() => builder().change(["description"], current => current));
    expect(log).not.toContain("edits a");
  });
});

describe("choosing another project", () => {
  it("closes what's open, so nothing goes on being sent to it", async () => {
    const { builder } = mount();
    await act(async () => {
      builder().chooseProject("shop");
      await builder().open("shop", "a");
    });
    act(() => {
      builder().chooseProject("other");
    });
    expect(builder().opened).toBeNull();
    expect(builder().view).toBeNull();
    expect(builder().canUndo).toBe(false);
  });

  it("keeps what's open when it's the same project", async () => {
    const { builder } = mount();
    await act(async () => {
      builder().chooseProject("shop");
      await builder().open("shop", "a");
    });
    act(() => {
      builder().chooseProject("shop");
    });
    await waitFor(() => {
      expect(builder().opened?.name).toBe("a");
    });
  });
});
