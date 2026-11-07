/**
 * @file What feeds the live region. A message stays long enough to be heard, so
 *   the next does not replace it mid-sentence; what comes meanwhile is said
 *   together after it, so nothing is lost and a burst does not fall behind.
 *   Each message empties the region first and fills it on the next tick, so the
 *   same words twice are heard twice: a screen reader speaks a change.
 */

import type { Container } from "react-containerized-state";

import { plainWords } from "../components/code-text.tsx";

/** How long a message stays before another takes its place. */
const DWELL_MS = 1000;

export const createAnnouncer = (region: Container<string>) => {
  const waiting: string[] = [];
  let holding = false;

  const say = (message: string): void => {
    holding = true;
    void region.setValue("");
    setTimeout(() => {
      void region.setValue(message);
    }, 0);
    setTimeout(() => {
      holding = false;
      if (waiting.length > 0) say(waiting.splice(0).join(" "));
    }, DWELL_MS);
  };

  return (message: string): void => {
    // A screen reader hears the words, not the marks around a value.
    const words = plainWords(message);
    if (holding) waiting.push(words);
    else say(words);
  };
};
