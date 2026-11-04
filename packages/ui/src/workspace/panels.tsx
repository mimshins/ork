/**
 * @file The workspace's panels: each one's id, title, icon and body. Every
 *   panel in the UI is one entry here; the dock, the rail, the stack, the
 *   Window menu and the command palette all read this list.
 */

import type { ComponentType } from "react";

import { BuilderPanel } from "../builder/builder-panel.tsx";
import {
  IconBuilder,
  IconChats,
  IconDecisions,
  IconLogs,
  IconMonitor,
  IconNotifications,
  IconUsage,
  IconRuns,
} from "../components/icons.tsx";
import { ChatsPanel } from "../panels/chats-panel.tsx";
import { DecisionsPanel } from "../panels/decisions-panel.tsx";
import { LogsPanel } from "../panels/logs-panel.tsx";
import { MonitorPanel } from "../panels/monitor-panel.tsx";
import { NotificationsPanel } from "../panels/notifications-panel.tsx";
import { RunsPanel } from "../panels/runs-panel.tsx";
import { UsagePanel } from "../panels/usage-panel.tsx";

export type PanelId =
  | "runs"
  | "monitor"
  | "logs"
  | "decisions"
  | "chats"
  | "notifications"
  | "usage"
  | "builder";

export type PanelSpec = {
  id: PanelId;
  title: string;
  Icon: ComponentType;
  Body: ComponentType;
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
  usage: {
    id: "usage",
    title: "Usage",
    Icon: IconUsage,
    Body: UsagePanel,
  },
  builder: {
    id: "builder",
    title: "Builder",
    Icon: IconBuilder,
    Body: BuilderPanel,
  },
};

export const PANELS: readonly PanelSpec[] = Object.values(SPECS);

export const isPanelId = (id: string): id is PanelId => id in SPECS;

export const panelOf = (id: PanelId): PanelSpec => SPECS[id];
