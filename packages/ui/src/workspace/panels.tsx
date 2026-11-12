/**
 * @file The workspace's panels: each one's id, title, icon and body. Every
 *   panel in the UI is one entry here; the dock, the rail, the stack, the
 *   Window menu and the command palette all read this list.
 */

import { BuilderPanel } from "../builder/builder-panel.tsx";
import {
  IconBuilder,
  IconChats,
  IconDecisions,
  IconLogs,
  IconMonitor,
  IconNotifications,
  IconRuns,
} from "../components/icons.tsx";
import { ChatsPanel } from "../panels/chats-panel.tsx";
import { DecisionsPanel } from "../panels/decisions-panel.tsx";
import { LogsPanel } from "../panels/logs-panel.tsx";
import { MonitorPanel } from "../panels/monitor-panel.tsx";
import { NotificationsPanel } from "../panels/notifications-panel.tsx";
import { RunsPanel } from "../panels/runs-panel.tsx";
import { REVIEW_PANELS } from "./review-panels.tsx";

export type PanelId =
  | "runs"
  | "monitor"
  | "logs"
  | "decisions"
  | "chats"
  | "notifications"
  | "usage"
  | "builder"
  | "context"
  | "feedback"
  | "worktrees"
  | "followups";

export type PanelSpec = {
  id: PanelId;
  title: string;
  /** Every panel's icon and body take no props, as these do. */
  Icon: typeof IconRuns;
  Body: typeof RunsPanel;
};

const SPECS: Record<PanelId, PanelSpec> = {
  runs: { id: "runs", title: "Runs", Icon: IconRuns, Body: RunsPanel },
  monitor: {
    id: "monitor",
    title: "Monitor",
    Icon: IconMonitor,
    Body: MonitorPanel,
  },
  logs: {
    id: "logs",
    title: "Logs",
    Icon: IconLogs,
    Body: LogsPanel,
  },
  decisions: {
    id: "decisions",
    title: "Decisions",
    Icon: IconDecisions,
    Body: DecisionsPanel,
  },
  chats: {
    id: "chats",
    title: "Chats",
    Icon: IconChats,
    Body: ChatsPanel,
  },
  notifications: {
    id: "notifications",
    title: "Notifications",
    Icon: IconNotifications,
    Body: NotificationsPanel,
  },
  usage: { id: "usage", ...REVIEW_PANELS.usage },
  builder: {
    id: "builder",
    title: "Builder",
    Icon: IconBuilder,
    Body: BuilderPanel,
  },
  context: { id: "context", ...REVIEW_PANELS.context },
  // Last, so the others keep their Go to digits: it has none of its own.
  feedback: { id: "feedback", ...REVIEW_PANELS.feedback },
  // After Feedback, so no Go to digit moves; it has none either.
  worktrees: { id: "worktrees", ...REVIEW_PANELS.worktrees },
  // After Worktrees, so no Go to digit moves; it has none either.
  followups: { id: "followups", ...REVIEW_PANELS.followups },
};

export const PANELS: readonly PanelSpec[] = Object.values(SPECS);

export const isPanelId = (id: string): id is PanelId => id in SPECS;

export const panelOf = (id: PanelId): PanelSpec => SPECS[id];
