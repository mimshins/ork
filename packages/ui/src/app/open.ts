/**
 * @file What the page opens once: its state, on the server's API and the
 *   browser's streams and storage; and its workspace, at the window's width.
 */

import { toasts } from "../components/toast.tsx";
import { type AppState, createAppState } from "../state/app-state.ts";
import { browserStorage } from "../state/storage.ts";
import { openEventSource } from "../state/stream-link.ts";
import { WIDE_QUERY } from "../workspace/workspace-view.ts";
import { createWorkspace, type Workspace } from "../workspace/workspace.ts";
import { api } from "./api.ts";

export const openState = (): AppState =>
  createAppState({
    client: api,
    open: openEventSource,
    storage: browserStorage(),
  });

export const openWorkspace = (): Workspace =>
  createWorkspace({
    storage: browserStorage(),
    wide: window.matchMedia(WIDE_QUERY).matches,
    onLayoutDropped: () => {
      toasts.add({
        title: "Layout reset",
        description: "The saved layout could not be read.",
      });
    },
  });
