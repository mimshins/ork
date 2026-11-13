/**
 * @file The filter bar's tests' setup: the real app state on a fake server that
 *   answers the fields (or refuses the first reads), and a host that holds the
 *   applied values as a panel does.
 */

import { createClient } from "@krapht/ork-server/client";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  FilterBar,
  type FilterBarProps,
} from "../../src/components/filter-bar.tsx";
import type { FilterValues } from "../../src/components/filter-model.ts";
import { TipProvider } from "../../src/components/tip.tsx";
import { type AppState, createAppState } from "../../src/state/app-state.ts";
import { AppStateProvider } from "../../src/state/context.tsx";
import { openFakeSources } from "../fake-source.ts";
import { LIST_FIELDS } from "../filter-fields.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** A server that answers the fields, or refuses the first `refusals` reads. */
export const stateOn = (refusals = 0) => {
  let reads = 0;
  const state = createAppState({
    client: createClient({
      fetch: () => {
        reads += 1;
        return Promise.resolve(
          reads <= refusals
            ? json({ error: "Nothing answers." }, 500)
            : json(LIST_FIELDS),
        );
      },
    }),
    open: openFakeSources().open,
    storage: localStorage,
  });
  return { state, reads: () => reads };
};

export type HostProps = Omit<FilterBarProps, "values" | "onChange"> & {
  start?: FilterValues;
  onChange?: (next: FilterValues) => void;
};

/** A panel's part: it holds the applied values and hands them back. */
const NONE: FilterValues = {};

export const Host = ({ start = NONE, onChange, ...bar }: HostProps) => {
  const [values, setValues] = useState(start);
  return (
    <FilterBar
      {...bar}
      onChange={next => {
        setValues(next);
        onChange?.(next);
      }}
      values={values}
    />
  );
};

/** Draws the bar at once, without waiting for the fields. */
export const drawNow = (props: HostProps, state: AppState) =>
  render(
    <AppStateProvider value={state}>
      <TipProvider>
        <Host {...props} />
      </TipProvider>
    </AppStateProvider>,
  );

export const draw = async (props: HostProps, state = stateOn().state) => {
  const rendered = drawNow(props, state);
  await screen.findByRole("search");
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
};

/** The text of what an element's `aria-describedby` names. */
export const describedText = (element: HTMLElement): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map(id => document.querySelector(`[id="${id}"]`)?.textContent ?? "")
    .join(" ")
    .trim();
