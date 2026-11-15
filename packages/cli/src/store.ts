/**
 * @file Opening the user's store (`~/.ork/state.db`) for the length of one
 *   command, and closing it after, whatever happens. A store that can't be
 *   opened (not a database, no access) is one line, not a stack trace.
 */

import { type EventStore, openStore, storePath } from "@krapht/ork-core";

import { argumentError } from "./argument-error.ts";

/** What to say when the store can't be opened, and what to do. */
export const storeProblem = (error: unknown): string =>
  `Can't open Ork's store at ${storePath()}: ${error instanceof Error ? error.message : String(error)}. Move the file aside, and Ork starts a new one.`;

/** Runs `body` with the user's store open, and closes it after. */
export const withStore = async (
  body: (store: EventStore) => Promise<void> | void,
): Promise<void> => {
  let store: EventStore;
  try {
    store = openStore();
  } catch (error) {
    // citty prints its own argument errors as one line.
    throw argumentError(storeProblem(error));
  }
  try {
    await body(store);
  } finally {
    store.close();
  }
};
