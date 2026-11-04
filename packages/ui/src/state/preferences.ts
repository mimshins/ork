/**
 * @file What a browser keeps of the user's choices: the theme, the density, and
 *   whether desktop notifications may be sent, which the notification center
 *   reads. Saved values are checked before use, since they may come from an
 *   older Ork; a field that is missing takes its default, and values that do
 *   not fit are dropped. `followPreferences` keeps the page's look on them.
 */

import { PersistentContainer } from "containerized-state-plugin-persistence";
import type { Container } from "react-containerized-state";
import { z } from "zod";

import { applyChoice, followSystem, type View } from "../design/theme.ts";

/** What the project filters start at. */
export const ALL_PROJECTS = "all";

/** What the Usage panel's period starts at. */
export const DEFAULT_PERIOD = "30";

const PREFERENCES_KEY = "ork.preferences.v1";

export const PreferencesSchema = z.object({
  theme: z.enum(["system", "dark", "light"]).default("system"),
  density: z.enum(["compact", "comfortable"]).default("compact"),
  desktopNotifications: z.boolean().default(false),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "compact",
  desktopNotifications: false,
};

export type PreferenceStore = {
  value: Container<Preferences>;
  update: (change: Partial<Preferences>) => void;
};

export const createPreferences = (storage: Storage): PreferenceStore => {
  const saved = new PersistentContainer<Preferences>(DEFAULT_PREFERENCES, {
    key: PREFERENCES_KEY,
    storage,
  });
  const checked = PreferencesSchema.safeParse(saved.getValue());
  if (checked.success) void saved.setValue(checked.data);
  else void saved.reset();
  return {
    value: saved,
    update: change => {
      void saved.setValue({ ...saved.getValue(), ...change });
    },
  };
};

/** Keeps the page's look on the preferences; returns how to stop. */
export const followPreferences = (
  view: View,
  preferences: PreferenceStore,
): (() => void) => {
  const { value } = preferences;
  const root = view.document.documentElement;
  const setDensity = (): void => {
    root.dataset["density"] = value.getValue().density;
  };
  setDensity();
  const stopSystem = followSystem(view, () => value.getValue().theme);
  const stopChoices = value.subscribe(() => {
    setDensity();
    applyChoice(view, value.getValue().theme);
  });
  return () => {
    stopSystem();
    stopChoices();
  };
};
