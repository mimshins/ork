/**
 * @file The workspace, for what is rendered with its own props: dockview's
 *   header buttons, and panels that have something to announce. None outside a
 *   shell.
 */

import { createContext } from "react";

import type { Workspace } from "./workspace.ts";

export type { Workspace };

export const WorkspaceContext = createContext<Workspace | null>(null);
