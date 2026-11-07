/**
 * @file The environment's say over the update check (ADR-038): the variables
 *   that turn it off (`ORK_NO_UPDATE_CHECK`, the common `NO_UPDATE_NOTIFIER`,
 *   and `CI`), and the registry to ask instead of npm's. The CLI adds its own
 *   rules about where a notice may go; the server behind `ork ui` uses only
 *   these.
 */

/** Turns the automatic check and its notice off. */
export const NO_UPDATE_ENV = "ORK_NO_UPDATE_CHECK";

/** A registry to ask instead of npm's, e.g. a company mirror. */
export const UPDATE_REGISTRY_ENV = "ORK_UPDATE_REGISTRY";

/** The variables that turn the check off, in the order they are looked at. */
export const UPDATE_SWITCHES = [
  NO_UPDATE_ENV,
  "NO_UPDATE_NOTIFIER",
  "CI",
] as const;

export type UpdateSwitch = (typeof UPDATE_SWITCHES)[number];

type Env = Readonly<Record<string, string | undefined>>;

/** Set to anything but empty, `0` or `false`. */
export const isSwitchedOn = (value: string | undefined): boolean =>
  value !== undefined &&
  value !== "" &&
  value !== "0" &&
  value.toLowerCase() !== "false";

/** The variable that turns the check off in `env`, or `null` when none does. */
export const updateSwitchOff = (env: Env): UpdateSwitch | null =>
  UPDATE_SWITCHES.find(name => isSwitchedOn(env[name])) ?? null;

/** The registry `ORK_UPDATE_REGISTRY` names, if it names one. */
export const registryOf = (env: Env): string | undefined => {
  const registry = env[UPDATE_REGISTRY_ENV];
  return registry === undefined || registry === "" ? undefined : registry;
};

/** The host of a registry that isn't an http(s) URL, past any `user:pass@`. */
const hostOf = (registry: string): string =>
  registry
    .replace(/^[a-z][\w+.-]*:\/\//iu, "")
    .replace(/^[^/?#]*@/u, "")
    .split(/[/?#]/u)[0] ?? "";

/**
 * The registry as it may be shown (on a page, in a message): an http(s) URL
 * without its user name and password, which a mirror's URL may carry; anything
 * else only as its host.
 */
export const registryShown = (registry: string): string => {
  try {
    const url = new URL(registry);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.username === "" && url.password === "") return registry;
      url.username = "";
      url.password = "";
      return url.href;
    }
  } catch {
    // Not a URL: only its host is shown.
  }
  return hostOf(registry);
};
