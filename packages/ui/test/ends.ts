/** @file How a node ended, as the server serves it, for the tests. */

import type { EndView } from "@krapht/ork-server/client";

export const DONE: EndView = {
  kind: "done",
  message: "finished",
  label: "Done",
  actor: null,
  transient: false,
  hint: "",
  docsAnchor: "done",
};

export const TURN_LIMIT: EndView = {
  kind: "turn_limit",
  message: "reached its turn limit (8)",
  label: "Turn limit",
  actor: "workflow",
  transient: false,
  hint: "Raise its `maxTurns`, or give it a smaller task.",
  docsAnchor: "turn-limit",
};

export const RATE_LIMITED: EndView = {
  kind: "rate_limited",
  message: "was asked by its provider to slow down",
  detail: '{"type":"error","error":{"type":"rate_limit_error"}}',
  label: "Rate limited",
  actor: "provider",
  transient: true,
  hint: "This may pass: `ork resume` tries again.",
  docsAnchor: "rate-limited",
};

export const OUT_OF_CREDITS: EndView = {
  kind: "out_of_credits",
  message: "found no credit left on its account",
  label: "Out of credits",
  actor: "account",
  transient: false,
  hint: "Add credit to the account, or use another, then `ork resume`.",
  docsAnchor: "out-of-credits",
};

export const UNKNOWN: EndView = {
  kind: "unknown",
  message: "ended for a reason Ork doesn't recognize",
  label: "Unknown",
  actor: "ork",
  transient: false,
  hint: "Ork files it as a bug, so a rule can be added.",
  docsAnchor: "unknown",
};
