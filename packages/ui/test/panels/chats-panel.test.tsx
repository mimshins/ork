/**
 * @file Tests for the Chats panel on a fake server: it shows a node's thread,
 *   follows the shared selection, sends with Enter and keeps a refusal, and
 *   gives the command for a run that has ended.
 */

import type { RunView, StoredEvent } from "@krapht/ork-server/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatsPanel } from "../../src/panels/chats-panel.tsx";
import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { DONE, TURN_LIMIT } from "../ends.ts";
import { runView } from "../state/fixtures.ts";
import { type FakeRoutes, openPanelState, renderPanel } from "./harness.tsx";

const at = "2026-11-03T00:00:00.000Z";

const stored = (seq: number, event: StoredEvent["event"]): StoredEvent => ({
  runId: "aaa11111",
  seq,
  at,
  event,
});

const EVENTS: StoredEvent[] = [
  stored(1, {
    type: "run.started",
    runId: "aaa11111",
    workflow: "w",
    entries: ["lead"],
    nodes: [
      { id: "lead", type: "agent.leader" },
      { id: "kid", type: "agent.worker", parent: "lead" },
      { id: "sh", type: "tool.shell" },
    ],
  }),
  stored(2, {
    type: "node.event",
    id: "lead",
    event: { type: "assistant.text", text: "Planning the work." },
  }),
  stored(3, {
    type: "user.message",
    node: "lead",
    body: "Keep it small.",
    delivered: "now",
  }),
  stored(4, {
    type: "message.sent",
    node: "kid",
    to: "lead",
    message: 1,
    body: "Done here.",
  }),
  stored(5, {
    type: "node.event",
    id: "kid",
    event: { type: "assistant.text", text: "Only for the kid." },
  }),
];

const open = async (
  routes: FakeRoutes = {},
  run: RunView = runView("aaa11111"),
) => {
  const opened = openPanelState({ events: EVENTS, ...routes });
  renderPanel(opened.state, <ChatsPanel />);
  await act(async () => {
    opened.overview.send("runs", [run]);
    opened.state.selectRun(run.id);
    await Promise.resolve();
  });
  return opened;
};

const box = (): Promise<HTMLElement> =>
  screen.findByRole("textbox", { name: /^Message to/u });

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Chats panel", () => {
  it("asks for a run when none is chosen", () => {
    const { state } = openPanelState({});
    renderPanel(state, <ChatsPanel />);
    expect(screen.getByText("No run chosen.")).toBeDefined();
  });

  it("shows what was asked as written, and marks Ork's own words", async () => {
    await open({
      events: [
        ...EVENTS,
        stored(6, {
          type: "decision.opened",
          node: "lead",
          decision: "d",
          kind: "question",
          question: "Run `rm`?",
          options: [],
        }),
        stored(7, {
          type: "node.finished",
          id: "lead",
          round: 1,
          ok: false,
          output: {},
          error: "`lead` broke",
          end: TURN_LIMIT,
        }),
      ],
    });
    const asked = await screen.findByText("Asked you: Run `rm`?");
    expect(asked.querySelector("code")).toBeNull();
    const failed = await screen.findByText("Failed: `lead` broke");
    expect(failed.querySelector("code")).toBeNull();
  });

  it("shows the first node's thread, naming who said what", async () => {
    await open();
    const log = await screen.findByRole("log", {
      name: "Conversation with lead",
    });
    const here = within(log);
    expect(here.getByText("Planning the work.")).toBeDefined();
    expect(here.getByText("Keep it small.")).toBeDefined();
    expect(here.getByText("You")).toBeDefined();
    expect(here.getByText("delivered to its session")).toBeDefined();
    expect(here.getByText("Done here.")).toBeDefined();
    expect(here.getByText("kid")).toBeDefined();
    expect(here.queryByText("Only for the kid.")).toBeNull();
  });

  it("shows a node's report as its last word, and Ork's tools by short names", async () => {
    await open({
      events: [
        EVENTS[0],
        stored(2, {
          type: "node.event",
          id: "lead",
          event: {
            type: "tool.called",
            id: "t1",
            name: "mcp__ork__ask_user",
            input: {},
          },
        }),
        stored(3, {
          type: "node.event",
          id: "lead",
          event: {
            type: "tool.called",
            id: "t2",
            name: "StructuredOutput",
            input: {},
          },
        }),
        stored(4, {
          type: "node.finished",
          id: "lead",
          round: 1,
          ok: true,
          output: { status: "pass", summary: "The note is blue." },
          end: DONE,
        }),
      ].filter(event => event !== undefined),
    });
    const log = await screen.findByRole("log", {
      name: "Conversation with lead",
    });
    expect(within(log).getByText("The note is blue.")).toBeDefined();
    expect(within(log).getByText("its report")).toBeDefined();
    expect(within(log).getByText("Used ask_user")).toBeDefined();
    expect(within(log).queryByText(/StructuredOutput/u)).toBeNull();
    expect(within(log).queryByText("Finished.")).toBeNull();
  });

  it("follows the shared selection, past a node with no session", async () => {
    const { state } = await open();
    await screen.findByRole("log", { name: "Conversation with lead" });
    await act(async () => {
      state.selectNode("kid");
      await Promise.resolve();
    });
    expect(
      screen.getByRole("log", { name: "Conversation with kid" }),
    ).toBeDefined();
    await act(async () => {
      state.selectNode("sh");
      await Promise.resolve();
    });
    expect(
      screen.getByRole("log", { name: "Conversation with lead" }),
    ).toBeDefined();
  });

  it("sends with Enter, clears, and keeps a new line with Shift+Enter", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    const field = await box();
    await user.type(field, "one{Shift>}{Enter}{/Shift}two{Enter}");
    await vi.waitFor(() => {
      expect(controlled).toEqual([
        {
          kind: "message",
          run: "aaa11111",
          body: { node: "lead", body: "one\ntwo" },
        },
      ]);
    });
    await vi.waitFor(() => {
      expect(field).toHaveProperty("value", "");
    });
  });

  it("sends nothing when nothing is written", async () => {
    const user = userEvent.setup();
    const { controlled } = await open();
    await user.type(await box(), "   {Enter}");
    expect(controlled).toEqual([]);
  });

  it("keeps what was written, and the refusal, when refused", async () => {
    const user = userEvent.setup();
    await open({
      monitor: {
        tree: [],
        graph: { nodes: [], edges: [], channels: [] },
        refuse: "Not running.",
      },
    });
    const field = await box();
    await user.type(field, "hello{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("Not running.");
    expect(field).toHaveProperty("value", "hello");
  });

  it("gives the command for a run that has ended", async () => {
    await open({}, runView("aaa11111", "succeeded"));
    expect(await screen.findByText("ork chat aaa11111 lead")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: /^Message to/u })).toBeNull();
  });

  it("keeps the focus in the panel when the run ends while writing", async () => {
    const { overview } = await open();
    (await box()).focus();
    await act(async () => {
      overview.send("runs", [runView("aaa11111", "succeeded")]);
      await Promise.resolve();
    });
    await screen.findByText("ork chat aaa11111 lead");
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Message to lead" }),
    );
    expect(document.activeElement?.textContent).toContain("has ended");
  });

  it("ties the composer's keys to its box", async () => {
    await open();
    expect(
      await screen.findByRole("textbox", {
        name: /^Message to/u,
        description: /Enter sends/u,
      }),
    ).toBeDefined();
  });

  it("stays on the newest when the panel is shown again", async () => {
    const observed: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observed.push(callback);
        }
        observe = (): void => {};
        unobserve = (): void => {};
        disconnect = (): void => {};
      },
    );
    await open();
    const thread = await screen.findByRole("log");
    Object.defineProperty(thread, "scrollHeight", { value: 900 });
    thread.scrollTop = 0;
    for (const callback of observed) callback();
    expect(thread.scrollTop).toBe(900);
  });

  it("asks to continue a paused run, with no command", async () => {
    await open({}, runView("aaa11111", "paused"));
    expect(await screen.findByText(/Continue it to write/u)).toBeDefined();
  });

  it("says when a run has no one to talk to", async () => {
    await open({
      events: [
        stored(1, {
          type: "run.started",
          runId: "aaa11111",
          workflow: "w",
          entries: ["sh"],
          nodes: [{ id: "sh", type: "tool.shell" }],
        }),
      ],
    });
    expect(
      await screen.findByText("This run has no one to talk to."),
    ).toBeDefined();
  });

  it("has nothing for axe to find", async () => {
    await open();
    await box();
    await expect(violations(document.body)).resolves.toEqual([]);
  });
});
