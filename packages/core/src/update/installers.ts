/**
 * @file How Ork was installed, so `ork upgrade` (and, in M2, the UI) can
 *   upgrade it the same way (ADR-038). Each way is an adapter in a registry,
 *   recognised by where the running script lives: a global install by npm,
 *   pnpm, yarn, bun or Volta has a command to run; a clone or `npx` gets advice
 *   instead. Adding a package manager is one more entry.
 */

/**
 * What to do when there is no command to run: the CLI's sentence, and the same
 * as words that lead to commands, for a page that shows each command apart (as
 * a code block) from the words around it.
 */
export type Advice = {
  /** `ork upgrade`'s line, as it prints it. */
  text: string;
  /** The words before the commands, ending in a colon; values in backticks. */
  words: string;
  /** Each command to run, in order. */
  commands: readonly string[];
};

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
  advice?: (spec: string, script: string) => Advice;
};

const SOURCE = "/packages/cli/";

/** Pnpm's global virtual store, where pnpm 11 keeps global packages. */
const PNPM_STORE_LINKS = /\/store\/v\d+\/links\//u;

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
    advice: (_spec, script) => {
      const root = script.slice(0, script.indexOf(SOURCE));
      return {
        text: `In ${root}: git pull, then pnpm install and pnpm build.`,
        words: `In \`${root}\`, run:`,
        commands: ["git pull", "pnpm install", "pnpm build"],
      };
    },
  },
  {
    id: "npx",
    label: "npx",
    owns: has("/_npx/"),
    advice: spec => ({
      text: `npx keeps its own copy: run npx ${spec} …, or install it with npm install --global ${spec}.`,
      words:
        "npx keeps its own copy: run the new version through npx, or install it with npm:",
      commands: [`npx ${spec} <command>`, `npm install --global ${spec}`],
    }),
  },
  {
    id: "pnpm",
    label: "pnpm (global)",
    // pnpm 11 links a global package from its store's global virtual store
    // (`<store>/v11/links/…`), which is where the real path leads.
    owns: script =>
      has("/pnpm/global/", "/.pnpm-global/")(script) ||
      PNPM_STORE_LINKS.test(script),
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
