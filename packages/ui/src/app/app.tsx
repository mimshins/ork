/**
 * @file The app's root: the providers every component needs, and for the page
 *   one workspace and one app state, which follows the server for as long as
 *   the app is mounted.
 */

import { useEffect, useLayoutEffect, useState } from "react";

import { TipProvider } from "../components/tip.tsx";
import { Toasts } from "../components/toast.tsx";
import { AppStateProvider } from "../state/context.tsx";
import { followPreferences } from "../state/preferences.ts";
import { Shell } from "../workspace/shell.tsx";
import { openState, openWorkspace } from "./open.ts";

export const App = () => {
  const [state] = useState(openState);
  const [workspace] = useState(openWorkspace);
  // Before the first paint, so a chosen theme does not flash the system's.
  useLayoutEffect(() => followPreferences(window, state.preferences), [state]);
  useEffect(() => state.start(), [state]);
  return (
    <AppStateProvider value={state}>
      <TipProvider>
        <Toasts>
          <Shell workspace={workspace} />
        </Toasts>
      </TipProvider>
    </AppStateProvider>
  );
};
