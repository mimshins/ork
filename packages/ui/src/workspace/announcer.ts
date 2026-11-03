/**
 * @file What feeds the live region. A message stays long enough to be heard, so
 *   the next does not replace it mid-sentence; what comes meanwhile is said
 *   together after it, so nothing is lost and a burst does not fall behind.
 */

import type { Container } from "react-containerized-state";

/** How long a message stays before another takes its place. */
const DWELL_MS = 1000;

export const createAnnouncer = (region: Container<string>) => {
  const waiting: string[] = [];
  let holding = false;

  const say = (message: string): void => {
    holding = true;
    void region.setValue(message);
    setTimeout(() => {
      holding = false;
      if (waiting.length > 0) say(waiting.splice(0).join(" "));
    }, DWELL_MS);
  };

  return (message: string): void => {
    if (holding) waiting.push(message);
    else say(message);
  };
};
