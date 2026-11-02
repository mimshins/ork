/**
 * @file The render-count tests: a component re-renders only when its own slice
 *   changes. A frame that changes another run, a run's frame for another panel,
 *   and a burst of frames each cost the components nothing or one render.
 */

import { act, cleanup, render } from "@testing-library/react";
import { Profiler, type ReactNode, StrictMode } from "react";
import { useComputedValue } from "react-containerized-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AppState, createAppState } from "../../src/state/app-state.ts";
import {
  AppStateProvider,
  useAppState,
  useRunFeed,
} from "../../src/state/context.tsx";
import { FLUSH_MS } from "../../src/state/run-feed.ts";
import { type FakeSources, openFakeSources } from "../fake-source.ts";
import { fakeServer, runView, span } from "./fixtures.ts";

let sources: FakeSources;
let renders: Record<string, number>;

/** Counts each commit of what it wraps. */
const Counted = ({ id, children }: { id: string; children: ReactNode }) => (
  <Profiler
    id={id}
    onRender={() => {
      renders[id] = (renders[id] ?? 0) + 1;
    }}
  >
    {children}
  </Profiler>
);

const RunRow = ({ state, id }: { state: AppState; id: string }) => {
  const live = useComputedValue(
    state.runs,
    runs => runs?.find(run => run.id === id)?.live,
  );
  return <p>{live}</p>;
};

const DecisionCount = ({ state }: { state: AppState }) => {
  const count = useComputedValue(state.decisions, list => list?.length);
  return <p>{count}</p>;
};

/** The state of the run's feed, read for as long as this is drawn. */
const useFeedState = (id: string) => {
  useRunFeed(id);
  return useAppState().feedOf(id).state;
};

const EventCount = ({ id }: { id: string }) => {
  const count = useComputedValue(
    useFeedState(id),
    ({ events }) => events.length,
  );
  return <p>{count}</p>;
};

const LinkWord = ({ id }: { id: string }) => {
  const link = useComputedValue(useFeedState(id), value => value.link);
  return <p>{link}</p>;
};

const openState = (): AppState =>
  createAppState({
    client: fakeServer(span(1, 3)).client,
    open: sources.open,
    storage: localStorage,
  });

/** Draws the components, each counted, and clears the count of first renders. */
const draw = async (state: AppState, children: ReactNode) => {
  render(<AppStateProvider value={state}>{children}</AppStateProvider>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  renders = {};
};

const overview = (state: AppState) => {
  state.start();
  return sources.last();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sources = openFakeSources();
  renders = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("what a change re-renders", () => {
  it("is only the row of the run that changed", async () => {
    const state = openState();
    const source = overview(state);
    source.send("runs", [runView("a"), runView("b")]);
    await draw(
      state,
      <>
        <Counted id="a">
          <RunRow
            id="a"
            state={state}
          />
        </Counted>
        <Counted id="b">
          <RunRow
            id="b"
            state={state}
          />
        </Counted>
      </>,
    );
    act(() => {
      source.send("runs", [runView("a"), runView("b", "paused")]);
    });
    expect(renders).toEqual({ b: 1 });
  });

  it("is nothing for a list with nothing new", async () => {
    const state = openState();
    const source = overview(state);
    source.send("runs", [runView("a")]);
    await draw(
      state,
      <Counted id="a">
        <RunRow
          id="a"
          state={state}
        />
      </Counted>,
    );
    act(() => {
      source.send("runs", [runView("a")]);
    });
    expect(renders).toEqual({});
  });

  it("stays within runs: decisions do not notice", async () => {
    const state = openState();
    const source = overview(state);
    source.send("decisions", []);
    await draw(
      state,
      <Counted id="count">
        <DecisionCount state={state} />
      </Counted>,
    );
    act(() => {
      source.send("runs", [runView("a")]);
    });
    expect(renders).toEqual({});
  });

  it("is one render for a burst of a run's events", async () => {
    const state = openState();
    await draw(
      state,
      <Counted id="events">
        <EventCount id="run" />
      </Counted>,
    );
    await act(async () => {
      for (const stored of span(4, 503))
        sources.last().send("run-event", stored);
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
    });
    expect(renders).toEqual({ events: 1 });
  });

  it("leaves a slice of the feed alone when the events change", async () => {
    const state = openState();
    await draw(
      state,
      <Counted id="link">
        <LinkWord id="run" />
      </Counted>,
    );
    await act(async () => {
      for (const stored of span(4, 4)) sources.last().send("run-event", stored);
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
    });
    expect(renders).toEqual({});
  });

  it("opens one stream and closes the rest under StrictMode", async () => {
    const state = openState();
    render(
      <StrictMode>
        <AppStateProvider value={state}>
          <EventCount id="run" />
        </AppStateProvider>
      </StrictMode>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(sources.all.filter(({ closed }) => !closed)).toHaveLength(1);
  });
});
