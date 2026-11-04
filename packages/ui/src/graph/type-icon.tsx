/** @file The icon for a node's type, the same on a graph card and in the tree. */

import type { ReactElement } from "react";

import {
  IconAws,
  IconCall,
  IconConsole,
  IconGate,
  IconGit,
  IconGitHub,
  IconJoin,
  IconLeader,
  IconRouter,
  IconSplit,
  IconSubagent,
  IconWorker,
} from "../components/icons.tsx";

const ICONS = new Map<string, ReactElement>([
  ["claude.leader", <IconLeader key="leader" />],
  ["claude.worker", <IconWorker key="worker" />],
  ["claude.subagent", <IconSubagent key="subagent" />],
  ["control.split", <IconSplit key="split" />],
  ["control.join", <IconJoin key="join" />],
  ["control.router", <IconRouter key="router" />],
  ["human.gate", <IconGate key="gate" />],
  ["workflow.call", <IconCall key="call" />],
  ["mcp.call", <IconCall key="mcp" />],
  ["tool.gh", <IconGitHub key="gh" />],
  ["tool.aws", <IconAws key="aws" />],
  ["tool.git", <IconGit key="git" />],
]);

export const TypeIcon = ({ type }: { type: string }): ReactElement =>
  ICONS.get(type) ?? <IconConsole />;
