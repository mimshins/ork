/**
 * @file Tests for the Decisions panel's filter bar (the shared bar, on the
 *   `decisions` list): it always shows, a value refetches `GET /api/decisions`
 *   with the query, a refused value shows the server's words and keeps the
 *   list, Clear filter resets, the command is the twin, a saved value is kept,
 *   and a decision opening while filtered is read again.
 */

import type { DecisionRecord, ProjectRecord } from "@krapht/ork-server/client";
import { act, cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionsPanel } from "../../src/panels/decisions-panel.tsx";
import { stubWindow } from "../dom.ts";
import { runView } from "../state/fixtures.ts";
import { openPanelState, project, renderPanel } from "./harness.tsx";

const decision = (id: string, runId: string): DecisionRecord => ({
  id,
  runId,
  node: "gate",
  kind: "question",
  question: `Ask ${id}?`,
  options: [{ id: "yes" }, { id: "no" }],
  openedAt: "2026-11-03T00:00:00.000Z",
  status: "open",
});

const RUNS = [
  { ...runView("aaa11111"), workflow: "feature", project: "/repos/shop" },
  { ...runView("bbb22222"), workflow: "feature", project: "/repos/shop" },
  { ...runView("ccc33333"), workflow: "review", project: "/repos/shop" },
];

const LIST = [
  decision("d1", "aaa11111"),
  decision("d2", "aaa11111"),
  decision("d3", "bbb22222"),
  decision("d4", "ccc33333"),
];

const WORKFLOW_OF: Record<string, string> = {
  aaa11111: "feature",
  bbb22222: "feature",
  ccc33333: "review",
};

/** What a fake `GET /api/decisions` answers, and what it was asked. */
type Server = {
  list: DecisionRecord[];
  asked: string[];
  /** A value it refuses, with its words. */
  refuse?: { workflow: string; words: string };
};

const decisionsRoute =
  (server: Server) =>
  (
    path: string,
    _body: unknown,
    query: URLSearchParams,
  ): Response | undefined => {
    if (path !== "/api/decisions") return undefined;
    server.asked.push(query.toString());
    const workflow = query.get("workflow");
    const run = query.get("run");
    if (workflow !== null && workflow === server.refuse?.workflow) {
      return new Response(JSON.stringify({ error: server.refuse.words }), {
        status: 400,
      });
    }
    return new Response(
      JSON.stringify(
        server.list.filter(
          ({ runId }) =>
            (workflow === null || WORKFLOW_OF[runId] === workflow) &&
            (run === null || runId === run),
        ),
      ),
    );
  };

const open = async (
  extra: Partial<Server> = {},
  projects: ProjectRecord[] = [],
) => {
  const server: Server = { list: LIST, asked: [], ...extra };
  const opened = openPanelState({
    builder: decisionsRoute(server),
    projects,
  });
  renderPanel(opened.state, <DecisionsPanel />);
  await act(async () => {
    opened.overview.send("runs", RUNS);
    opened.overview.send("decisions", server.list);
    await Promise.resolve();
  });
  return { ...opened, server };
};

/** Types into a field of the bar and applies it. */
const apply = async (label: string, text: string): Promise<void> => {
  const field = await screen.findByRole("combobox", { name: label });
  await userEvent.clear(field);
  await userEvent.type(field, `${text}{Enter}`);
};

/** Presses the first button of that name: the bar's, or the empty state's. */
const clickFirst = async (name: string): Promise<void> => {
  const [first] = screen.getAllByRole("button", { name });
  if (first !== undefined) await userEvent.click(first);
};

const asked = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-decision]")].map(
    card => card.dataset["decision"] ?? "",
  );

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the filter bar", () => {
  it("shows for one run too, and says how many are open", async () => {
    const opened = await open({ list: [decision("d1", "aaa11111")] });
    expect(
      screen.getByRole("search", { name: "Filter decisions" }),
    ).toBeDefined();
    expect(screen.getByText("1 open decision.")).toBeDefined();
    expect(opened.server.asked).toEqual([]);
    expect(
      await screen.findByRole("combobox", { name: "Workflow" }),
    ).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Run" })).toBeDefined();
  });

  it("suggests the workflows and runs that have open decisions", async () => {
    await open();
    await userEvent.click(await screen.findByRole("combobox", { name: "Run" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(
      await screen.findByRole("option", { name: "bbb22222 · feature" }),
    ).toBeDefined();
  });

  it("reads the list with the value as a query, and says how many match", async () => {
    const { server } = await open();
    await apply("Workflow", "feature");
    expect(server.asked).toEqual(["workflow=feature"]);
    expect(asked()).toEqual(["d1", "d2", "d3"]);
    expect(screen.getByText("3 decisions match.")).toBeDefined();
  });

  it("sends both fields, and shows the matching command", async () => {
    const { server } = await open();
    await apply("Workflow", "feature");
    await apply("Run", "bbb22222");
    expect(server.asked.at(-1)).toBe("workflow=feature&run=bbb22222");
    expect(asked()).toEqual(["d3"]);
    expect(
      screen.getByRole("button", {
        name: "Copy command (ork decide --list --workflow feature --run bbb22222)",
      }),
    ).toBeDefined();
  });

  it("says the server's words for a refused value, and keeps the last list", async () => {
    const words = "--workflow takes a workflow of this project, not nope.";
    await open({ refuse: { workflow: "nope", words } });
    await apply("Workflow", "review");
    await apply("Workflow", "nope");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(words);
    expect(asked()).toEqual(["d4"]);
    expect(
      screen
        .getByRole("combobox", { name: "Workflow" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("shows the unfiltered list, the words and the plain command when the first filter is refused", async () => {
    const words = "--workflow takes a workflow of this project, not nope.";
    await open({ refuse: { workflow: "nope", words } });
    await apply("Workflow", "nope");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(words);
    expect(asked()).toEqual(["d1", "d2", "d3", "d4"]);
    expect(
      screen.getByRole("button", { name: "Copy command (ork decide --list)" }),
    ).toBeDefined();
  });

  it("keeps the last good filter's command while a later one is refused", async () => {
    const words = "--workflow takes a workflow of this project, not nope.";
    await open({ refuse: { workflow: "nope", words } });
    await apply("Workflow", "review");
    await apply("Workflow", "nope");
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", {
        name: "Copy command (ork decide --list --workflow review)",
      }),
    ).toBeDefined();
  });

  it("forgets a cleared filter's list when the next filter is refused", async () => {
    const words = "--workflow takes a workflow of this project, not nope.";
    await open({ refuse: { workflow: "nope", words } });
    await apply("Workflow", "review");
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await apply("Workflow", "nope");
    await screen.findByRole("alert");
    expect(asked()).toEqual(["d1", "d2", "d3", "d4"]);
    expect(
      screen.getByRole("button", { name: "Copy command (ork decide --list)" }),
    ).toBeDefined();
  });

  it("suggests the registered projects as Project with two or more", async () => {
    await open({}, [project("shop"), project("api")]);
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Project" }),
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(await screen.findByRole("option", { name: "api" })).toBeDefined();
    expect(screen.getByRole("option", { name: "shop" })).toBeDefined();
  });

  it("shows no Project with one registered project", async () => {
    await open({}, [project("shop")]);
    await screen.findByRole("combobox", { name: "Workflow" });
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  });

  it("clears the filter, and reads the stream's list again", async () => {
    const { server } = await open();
    await apply("Workflow", "review");
    expect(asked()).toEqual(["d4"]);
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(asked()).toHaveLength(4);
    expect(screen.getByText("Filter cleared.")).toBeDefined();
    expect(server.asked).toEqual(["workflow=review"]);
  });

  it("keeps the choice for the next visit, and a value nothing has now", async () => {
    await open();
    await apply("Workflow", "gone");
    await act(async () => {
      await Promise.resolve();
    });
    cleanup();
    await open();
    expect(
      await screen.findByText("No decisions match the filter."),
    ).toBeDefined();
    expect(
      (
        await screen.findByRole<HTMLInputElement>("combobox", {
          name: "Workflow",
        })
      ).value,
    ).toBe("gone");
  });

  it("says the filter, not the queue, is empty, and clears from there", async () => {
    await open();
    await apply("Run", "zzz99999");
    expect(
      await screen.findByText("No decisions match the filter."),
    ).toBeDefined();
    await clickFirst("Clear filter");
    expect(asked()).toHaveLength(4);
  });

  it("reads again when the stream's list changes while filtered", async () => {
    const { server, overview } = await open();
    await apply("Workflow", "review");
    server.list = [...LIST, decision("d5", "ccc33333")];
    await act(async () => {
      overview.send("decisions", server.list);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(asked()).toEqual(["d4", "d5"]);
    });
  });
});
