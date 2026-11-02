/**
 * @file Opening a link in the user's browser, for `ork ui`. Each way is an
 *   opener in a registry, tried in order when it applies to this platform:
 *   `open` on macOS, `wslview` then `xdg-open` under WSL, `xdg-open` on Linux.
 *   Adding a platform is one more entry. When none starts, the caller prints
 *   the link instead.
 */

import { spawn } from "node:child_process";

export type Opener = {
  id: string;
  /** Whether it can work on this platform and environment. */
  applies: (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => boolean;
  program: string;
};

const wsl = (env: NodeJS.ProcessEnv): boolean =>
  env["WSL_DISTRO_NAME"] !== undefined;

export const OPENERS: readonly Opener[] = [
  { id: "macos", applies: platform => platform === "darwin", program: "open" },
  {
    id: "wslview",
    applies: (platform, env) => platform === "linux" && wsl(env),
    program: "wslview",
  },
  {
    id: "xdg-open",
    applies: platform => platform === "linux" || platform === "freebsd",
    program: "xdg-open",
  },
];

/** Starts one program with the link; false when it cannot be started. */
const start = (program: string, url: string): Promise<boolean> =>
  new Promise(resolve => {
    const child = spawn(program, [url], { detached: true, stdio: "ignore" });
    child.once("error", () => {
      resolve(false);
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });

/** Opens `url` with the first opener that starts; false when none did. */
export const openInBrowser = async (
  url: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    openers?: readonly Opener[];
  } = {},
): Promise<boolean> => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  for (const opener of options.openers ?? OPENERS) {
    if (!opener.applies(platform, env)) continue;
    // oxlint-disable-next-line no-await-in-loop -- the next opener only when this one failed
    if (await start(opener.program, url)) return true;
  }
  return false;
};
