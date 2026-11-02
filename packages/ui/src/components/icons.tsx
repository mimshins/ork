/**
 * @file The UI's icons, from Material Design Icons (`@mdi/js`, ADR-042), named
 *   for what they mean here. Each is one path on MDI's 24 px grid, drawn in the
 *   current text color at the font's size, and the bundle takes only the ones
 *   imported. Each status has its own shape, so a status reads without color
 *   and in red-green color blindness. Icons are decoration: the word or the
 *   accessible name beside one says what it means.
 */

import {
  mdiCheck,
  mdiChevronDown,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiClose,
  mdiContentCopy,
  mdiHelpRhombusOutline,
  mdiMinus,
  mdiPause,
  mdiPlay,
  mdiStop,
  mdiStopCircleOutline,
} from "@mdi/js";

const icon = (path: string) => {
  const Icon = () => (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
    >
      <path d={path} />
    </svg>
  );
  return Icon;
};

export const IconRunning = icon(mdiCircleSlice8);
export const IconSucceeded = icon(mdiCheck);
export const IconWaiting = icon(mdiHelpRhombusOutline);
export const IconPaused = icon(mdiPause);
export const IconFailed = icon(mdiClose);
export const IconQueued = icon(mdiCircleOutline);
export const IconSkipped = icon(mdiMinus);
export const IconInterrupted = icon(mdiStopCircleOutline);

export const IconPlay = icon(mdiPlay);
export const IconPause = icon(mdiPause);
export const IconStop = icon(mdiStop);
export const IconClose = icon(mdiClose);
export const IconCheck = icon(mdiCheck);
export const IconChevronDown = icon(mdiChevronDown);
export const IconCopy = icon(mdiContentCopy);
