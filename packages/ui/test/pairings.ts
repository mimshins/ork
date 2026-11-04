/**
 * @file Which color tokens are drawn on which, and the WCAG 2.2 AA contrast
 *   each pairing needs: 4.5:1 for text (1.4.3), and 3:1 for the parts of a
 *   control, icons and the focus ring (1.4.11). The contrast test checks every
 *   pairing in every look, and fails on a color token that is in no pairing and
 *   not exempt, so a new token cannot skip the check. A component's tokens name
 *   these, and its test reads each state's pair from its own sheet.
 */

export type Pairing = { fg: string[]; bg: string[]; min: number };

const TEXT = 4.5;
const UI = 3;

/** Every surface text and controls are drawn on. */
const SURFACES = [
  "--surface-canvas",
  "--surface-frame",
  "--surface-sunken",
  "--surface-panel",
  "--surface-raised",
  "--surface-hover",
  "--surface-selected",
  "--surface-attention",
  "--surface-current",
  "--surface-live",
  "--surface-danger",
];

const STATUSES = [
  "running",
  "succeeded",
  "waiting",
  "paused",
  "failed",
  "queued",
  "skipped",
  "interrupted",
].map(status => `--color-status-${status}`);

export const PAIRINGS: Pairing[] = [
  {
    fg: [
      "--color-text",
      "--color-text-muted",
      "--color-action-text",
      "--color-live-text",
      "--color-link",
      "--color-danger-text",
      ...STATUSES,
    ],
    bg: SURFACES,
    min: TEXT,
  },
  {
    fg: ["--color-text-on-action"],
    bg: ["--color-action", "--color-action-hover"],
    min: TEXT,
  },
  { fg: ["--color-text-on-live"], bg: ["--color-live"], min: TEXT },
  {
    fg: ["--color-text-on-danger"],
    bg: ["--color-danger", "--color-danger-hover"],
    min: TEXT,
  },
  {
    fg: [
      "--color-focus",
      "--color-border-strong",
      "--color-action-edge",
      "--color-live-edge",
    ],
    bg: SURFACES,
    min: UI,
  },
];

/** Color tokens with no contrast to keep, and why. */
export const EXEMPT: Record<string, string> = {
  "--color-text-disabled": "inactive controls are exempt (WCAG 1.4.3)",
  "--color-border": "a hairline between panels, which their headers name",
  "--color-border-soft":
    "a hairline between rows, which their own text separates",
  "--color-grid-dot": "the canvas's dot grid, decoration only",
};
