/**
 * @file Tests for the notification center's state: what becomes an item, what a
 *   new browser counts as read, reading singly and all at once, the read state
 *   surviving a reload, and hearing only of what is new.
 */

import type { DecisionRecord, RunView } from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNotifications, itemsOf } from "../../src/state/notifications.ts";
import { runView } from "./fixtures.ts";

const decision: DecisionRecord = {
  id: "d1",
  runId: "aaa",
  node: "gate",
  kind: "question",
  question: "Ship?",
  options: [],
  openedAt: "2026-11-03T02:00:00.000Z",
  status: "open",
};

const ended = (id: string, finishedAt: string): RunView => ({
  ...runView(id, "failed"),
  finishedAt,
});

const EARLY = "2026-11-03T01:00:00.000Z";
const LATE = "2026-11-03T05:00:00.000Z";
const NOW = "2026-11-03T03:00:00.000Z";

const setup = () => {
  const runs = Container.create<readonly RunView[] | null>(null);
  const decisions = Container.create<readonly DecisionRecord[] | null>(null);
  const center = createNotifications({
    runs,
    decisions,
    storage: localStorage,
    now: () => NOW,
  });
  center.start();
  return { runs, decisions, center };
};

const shown = (center: ReturnType<typeof setup>["center"]) =>
  center.view.getValue();

beforeEach(() => {
  localStorage.clear();
});

describe("the notification center", () => {
  it("makes items of ended, crashed and paused runs and open decisions", () => {
    const items = itemsOf(
      [
        runView("run1", "running"),
        runView("run2", "succeeded"),
        runView("run3", "crashed"),
        runView("run4", "paused"),
        runView("run5", "budget_exhausted"),
        runView("run6", "interrupted"),
      ],
      [decision],
    );
    expect(items.map(({ runId }) => runId).toSorted()).toEqual([
      "aaa",
      "run2",
      "run3",
      "run4",
      "run5",
      "run6",
    ]);
    expect(items.find(({ kind }) => kind === "decision")?.title).toBe(
      "gate in run aaa asks: Ship?",
    );
  });

  it("waits for both streams", () => {
    const { runs, center } = setup();
    void runs.setValue([ended("run1", EARLY)]);
    expect(shown(center).items).toEqual([]);
  });

  it("counts what had ended as read in a new browser, but not what still waits", () => {
    const { runs, decisions, center } = setup();
    void runs.setValue([ended("run1", EARLY)]);
    void decisions.setValue([decision]);
    expect(shown(center).unread).toBe(1);
    expect(
      shown(center).items.find(({ kind }) => kind === "decision")?.unread,
    ).toBe(true);
  });

  it("counts what ends later as unread", () => {
    const { runs, decisions, center } = setup();
    void decisions.setValue([]);
    void runs.setValue([ended("run1", EARLY)]);
    void runs.setValue([ended("run2", LATE), ended("run1", EARLY)]);
    expect(shown(center).unread).toBe(1);
    expect(shown(center).items[0]?.runId).toBe("run2");
  });

  it("marks one read, and all read", () => {
    const { runs, decisions, center } = setup();
    void runs.setValue([ended("run2", LATE)]);
    void decisions.setValue([decision]);
    expect(shown(center).unread).toBe(2);
    center.markRead("decision:d1");
    expect(shown(center).unread).toBe(1);
    center.markRead("run:run2:failed");
    expect(shown(center).unread).toBe(0);
  });

  it("marks everything read at once, what still waits too", () => {
    const { decisions, runs, center } = setup();
    void runs.setValue([]);
    void decisions.setValue([decision]);
    center.markAllRead();
    expect(shown(center).unread).toBe(0);
  });

  it("remembers what was read across a reload", () => {
    const first = setup();
    void first.runs.setValue([]);
    void first.decisions.setValue([decision]);
    first.center.markRead("decision:d1");
    const second = setup();
    void second.runs.setValue([]);
    void second.decisions.setValue([decision]);
    expect(shown(second.center).unread).toBe(0);
  });

  it("drops a read state it cannot use", () => {
    localStorage.setItem("ork.notifications.read", '{"nope":1}');
    const { runs, decisions, center } = setup();
    void runs.setValue([]);
    void decisions.setValue([decision]);
    expect(shown(center).unread).toBe(1);
  });

  it("tells of what is new, not of what was there", () => {
    const { runs, decisions, center } = setup();
    const heard = vi.fn<(ids: string[]) => void>();
    center.onNew(fresh => {
      heard(fresh.map(({ id }) => id));
    });
    void runs.setValue([]);
    void decisions.setValue([decision]);
    expect(heard).not.toHaveBeenCalled();
    void runs.setValue([ended("run2", LATE)]);
    expect(heard).toHaveBeenCalledExactlyOnceWith(["run:run2:failed"]);
  });
});
