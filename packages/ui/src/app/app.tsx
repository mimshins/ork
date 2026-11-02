/**
 * @file The app's root: the providers every component needs, one workspace for
 *   the page, and the status of the Ork that serves it. The browser's storage
 *   may be off limits, as in a private window; the layout then lasts only as
 *   long as the page.
 */

import { useEffect, useState } from "react";

import { TipProvider } from "../components/tip.tsx";
import { toasts, Toasts } from "../components/toast.tsx";
import { Shell } from "../workspace/shell.tsx";
import { WIDE_QUERY } from "../workspace/workspace-view.ts";
import { createWorkspace, type Workspace } from "../workspace/workspace.ts";
import { api } from "./api.ts";

type Health = { version: string } | { error: string } | null;

const describe = (health: Health): string => {
  if (health === null) return "Connecting to ork ui…";
  return "error" in health
    ? `Cannot reach ork ui: ${health.error}`
    : `Ork ${health.version}`;
};

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

const browserStorage = (): Storage => {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
};

const openWorkspace = (): Workspace =>
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

export const App = () => {
  const [workspace] = useState(openWorkspace);
  const [health, setHealth] = useState<Health>(null);
  useEffect(() => {
    const stop = new AbortController();
    const load = async () => {
      const answer = await api.call("health");
      if (!stop.signal.aborted) {
        setHealth(answer.ok ? answer.data : { error: answer.error });
      }
    };
    void load();
    return () => {
      stop.abort();
    };
  }, []);
  return (
    <TipProvider>
      <Toasts>
        <Shell
          status={describe(health)}
          workspace={workspace}
        />
      </Toasts>
    </TipProvider>
  );
};
