/**
 * @file The Context panel's tests' harness: the panel on a fake server that
 *   answers each ask as told, a run to choose a node of, and the Monitor's and
 *   the Builder's ways of choosing one.
 */

import type {
  BuilderView,
  NodeContextAnswer,
  RunView,
} from "@krapht/ork-server/client";
import { act, screen } from "@testing-library/react";

import { ContextPanel } from "../../src/panels/context-panel.tsx";
import type { Workspace } from "../../src/workspace/context.ts";
import { runView } from "../state/fixtures.ts";
import { type ContextAsk, contextRoutes, planned } from "./context-fixtures.ts";
import { openPanelState, renderPanel } from "./harness.tsx";

export const RUN: RunView = {
  ...runView("aaa11111"),
  file: "/p/.ork/workflows/review.ork.yaml",
};

/** The panel on a fake server that answers each ask with `answer`. */
export const open = (
  answer: (ask: ContextAsk) => NodeContextAnswer | string = () => planned(),
  workspace: Workspace | null = null,
) => {
  const routes = contextRoutes(answer);
  const opened = openPanelState({ builder: routes.route });
  const view = renderPanel(opened.state, <ContextPanel />, workspace);
  return { ...opened, ...routes, view };
};

export type OpenedContext = ReturnType<typeof open>;

/** Chooses `node` of the run, as the Monitor does. */
export const chooseRunNode = async (
  opened: OpenedContext,
  node: string | null,
) => {
  await act(async () => {
    opened.overview.send("runs", [RUN]);
    opened.state.selectRun(RUN.id);
    opened.state.selectNode(node);
    await Promise.resolve();
  });
};

/** What the Builder shows of `review`, as far as the Context panel reads it. */
export const reviewView = (draft: boolean): BuilderView => ({
  name: "review",
  file: "/p/.ork/workflows/review.ork.yaml",
  text: "",
  document: null,
  graph: { nodes: [], edges: [], channels: [] },
  diagnostics: [],
  walk: null,
  draft,
  baseHash: null,
  changedOnDisk: false,
});

/**
 * Selects `node`'s card in the Builder, on its draft or its saved file, opening
 * `review` there first if it isn't open.
 */
export const chooseBuilderNode = async (
  opened: OpenedContext,
  node: string | null,
  draft = true,
) => {
  await act(async () => {
    const { builder } = opened.state;
    if (builder.opened.getValue()?.name !== "review") {
      builder.show({ project: "p", name: "review" }, reviewView(draft));
    }
    builder.select(node);
    await Promise.resolve();
  });
};

/** A piece's row, by the start of the name a screen reader hears. */
export const row = (name: RegExp): Promise<HTMLElement> =>
  screen.findByRole("button", { name });

const unspaced = (text: string): string => text.replaceAll(/\s+/gu, "");

/**
 * A piece's row by its whole name. jsdom's name computation drops the spaces a
 * browser keeps around words only a screen reader hears ("about 9 tokens" comes
 * out "about9tokens"), so the words, their order and the commas are compared,
 * not the spaces.
 */
export const rowNamed = (name: string): Promise<HTMLElement> =>
  screen.findByRole("button", {
    name: computed => unspaced(computed) === unspaced(name),
  });
