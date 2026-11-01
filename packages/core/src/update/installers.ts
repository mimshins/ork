/**
 * @file How Ork was installed, so `ork upgrade` (and, in M2, the UI) can
 *   upgrade it the same way (ADR-038). Each way is an adapter in a registry,
 *   recognised by where the running script lives: a global install by npm,
 *   pnpm, yarn, bun or Volta has a command to run; a clone or `npx` gets advice
 *   instead. Adding a package manager is one more entry.
 */

/** One way Ork can be installed. */
export type Installer = {
  id: string;
  /** What the CLI calls it, e.g. "npm (global)". */
  label: string;
  /** Whether the running script (its real path, `/`-separated) is this one's. */
  owns: (script: string) => boolean;
  /** The command that installs `spec` (`@krapht/ork@1.2.0`) this way. */
  command?: (spec: string) => readonly string[];
  /** What to do instead, when there is no command to run. */
  advice?: (spec: string, script: string) => string;
};

const SOURCE = "/packages/cli/";

const has =
  (...parts: readonly string[]) =>
  (script: string): boolean =>
    parts.some(part => script.includes(part));

export const INSTALLERS: readonly Installer[] = [
  {
    id: "source",
    label: "a clone of the repository",
    owns: script =>
      script.includes(SOURCE) && !script.includes("/node_modules/"),
    advice: (_spec, script) =>
      `In ${script.slice(0, script.indexOf(SOURCE))}: git pull, then pnpm install and pnpm build.`,
  },
  {
    id: "npx",
    label: "npx",
    owns: has("/_npx/"),
    advice: spec =>
      `npx keeps its own copy: run npx ${spec} …, or install it with npm install --global ${spec}.`,
  },
  {
    id: "pnpm",
    label: "pnpm (global)",
    owns: has("/pnpm/global/", "/.pnpm-global/"),
    command: spec => ["pnpm", "add", "--global", spec],
  },
  {
    id: "yarn",
    label: "yarn (global)",
    owns: has("/yarn/global/"),
    command: spec => ["yarn", "global", "add", spec],
  },
  {
    id: "bun",
    label: "bun (global)",
    owns: has("/.bun/install/global/"),
    command: spec => ["bun", "add", "--global", spec],
  },
  {
    id: "volta",
    label: "Volta",
    owns: has("/.volta/tools/"),
    command: spec => ["volta", "install", spec],
  },
  {
    id: "npm",
    label: "npm (global)",
    owns: has("/node_modules/"),
    command: spec => ["npm", "install", "--global", spec],
  },
];

/** The installer of the running script, or `undefined` when none fits. */
export const detectInstaller = (
  script: string,
  installers: readonly Installer[] = INSTALLERS,
): Installer | undefined => {
  const normal = script.replaceAll("\\", "/");
  return installers.find(i => i.owns(normal));
};
