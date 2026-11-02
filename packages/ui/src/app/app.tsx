/**
 * @file The app's root. For now it shows which Ork serves it; the workspace,
 *   its panels and the design system replace this (specs/ui.md).
 */

import { useEffect, useState } from "react";

import { api } from "./api.ts";

type Health = { version: string } | { error: string } | null;

const describe = (health: Health): string => {
  if (health === null) return "Connecting to ork ui…";
  return "error" in health
    ? `Cannot reach ork ui: ${health.error}`
    : `Ork ${health.version}`;
};

export const App = () => {
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
    <main>
      <h1>Ork</h1>
      <output>{describe(health)}</output>
    </main>
  );
};
