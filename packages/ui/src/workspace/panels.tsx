/**
 * @file The workspace's panels: each one's id, title, icon and body. Every
 *   panel in the UI is one entry here; the dock, the rail, the stack, the
 *   Window menu and the command palette all read this list. Until a panel is
 *   built, its body says so and names the CLI command that shows the same
 *   thing.
 */

import type { ComponentType } from "react";

import { EmptyState } from "../components/bits.tsx";
import {
  IconChats,
  IconDecisions,
  IconLogs,
  IconMonitor,
  IconNotifications,
  IconRuns,
} from "../components/icons.tsx";
import { DecisionsPanel } from "../panels/decisions-panel.tsx";
import { LogsPanel } from "../panels/logs-panel.tsx";
import { MonitorPanel } from "../panels/monitor-panel.tsx";
import { RunsPanel } from "../panels/runs-panel.tsx";

export type PanelId =
  | "runs"
  | "monitor"
  | "logs"
  | "decisions"
  | "chats"
  | "notifications";

export type PanelSpec = {
  id: PanelId;
  title: string;
  Icon: ComponentType;
  Body: ComponentType;
};

const notBuilt = (cli: string): ComponentType => {
  const Body = () => (
    <EmptyState title="Not built yet.">
      For now: <code>{cli}</code>
    </EmptyState>
  );
  return Body;
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
    Body: notBuilt("ork chat <run> <node>"),
  },
  notifications: {
    id: "notifications",
    title: "Notifications",
    Icon: IconNotifications,
    Body: notBuilt("ork ps"),
  },
};

export const PANELS: readonly PanelSpec[] = Object.values(SPECS);

export const isPanelId = (id: string): id is PanelId => id in SPECS;

export const panelOf = (id: PanelId): PanelSpec => SPECS[id];
