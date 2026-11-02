/**
 * @file Which color tokens are drawn on which, and the WCAG 2.2 AA contrast
 *   each pairing needs: 4.5:1 for text (1.4.3), and 3:1 for the parts of a
 *   control, icons and the focus ring (1.4.11). The contrast test checks every
 *   pairing in every look, and fails on a color token that is in no pairing and
 *   not exempt, so a new token cannot skip the check.
 */

export type Pairing = { fg: string[]; bg: string[]; min: number };

const TEXT = 4.5;
const UI = 3;

/** Every surface text and controls are drawn on. */
const SURFACES = [
  "--surface-canvas",
  "--surface-sunken",
  "--surface-panel",
  "--surface-raised",
  "--surface-hover",
  "--surface-selected",
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
      "--badge-text",
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
      "--button-border",
      "--button-primary-border",
      "--button-danger-border",
      "--field-border",
      "--popup-border",
    ],
    bg: SURFACES,
    min: UI,
  },
  {
    fg: ["--button-text"],
    bg: ["--button-bg", "--button-bg-hover"],
    min: TEXT,
  },
  {
    fg: ["--button-primary-text"],
    bg: ["--button-primary-bg", "--button-primary-bg-hover"],
    min: TEXT,
  },
  {
    fg: ["--button-danger-text"],
    bg: ["--button-danger-bg", "--button-danger-bg-hover"],
    min: TEXT,
  },
  {
    fg: ["--field-text", "--field-placeholder"],
    bg: ["--field-bg"],
    min: TEXT,
  },
  {
    fg: ["--panel-header-text", "--panel-header-text-active"],
    bg: ["--panel-header-bg", "--panel-bg"],
    min: TEXT,
  },
  { fg: ["--panel-tab-indicator"], bg: ["--panel-header-bg"], min: UI },
  { fg: ["--popup-text"], bg: ["--popup-bg"], min: TEXT },
  { fg: ["--kbd-text"], bg: ["--kbd-bg"], min: TEXT },
  {
    fg: ["--popup-text", "--menu-item-danger"],
    bg: ["--menu-item-hover", "--menu-item-selected"],
    min: TEXT,
  },
  { fg: ["--menu-item-danger"], bg: ["--popup-bg"], min: TEXT },
  { fg: ["--box-on-mark"], bg: ["--box-on-bg"], min: UI },
  {
    fg: ["--box-border", "--box-on-border", "--switch-thumb-off"],
    bg: ["--box-bg", "--surface-panel", "--surface-raised"],
    min: UI,
  },
  { fg: ["--tab-text", "--tab-text-active"], bg: ["--panel-bg"], min: TEXT },
  { fg: ["--tab-indicator"], bg: ["--panel-bg"], min: UI },
  { fg: ["--dialog-text", "--dialog-muted"], bg: ["--dialog-bg"], min: TEXT },
  { fg: ["--dialog-border"], bg: ["--dialog-bg"], min: UI },
  { fg: ["--toast-text", "--toast-muted"], bg: ["--toast-bg"], min: TEXT },
  { fg: ["--toast-border"], bg: ["--surface-canvas", "--toast-bg"], min: UI },
  {
    fg: ["--meter-fill", "--meter-fill-high"],
    bg: ["--meter-track"],
    min: UI,
  },
];

/** Color tokens with no contrast to keep, and why. */
export const EXEMPT: Record<string, string> = {
  "--color-text-disabled": "inactive controls are exempt (WCAG 1.4.3)",
  "--color-border": "a hairline between panels, which their headers name",
  "--panel-border": "the same hairline, for a panel",
  "--kbd-border": "decoration around a key hint's text",
  "--color-grid-dot": "the canvas's dot grid, decoration only",
};
