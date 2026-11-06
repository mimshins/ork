/**
 * @file Opening the user's store (`~/.ork/state.db`) for the length of one
 *   command, and closing it after, whatever happens.
 */

import { type EventStore, openStore } from "@krapht/ork-core";

/** Runs `body` with the user's store open, and closes it after. */
export const withStore = async (
  body: (store: EventStore) => Promise<void> | void,
): Promise<void> => {
  const store = openStore();
  try {
    await body(store);
  } finally {
    store.close();
  }
};
