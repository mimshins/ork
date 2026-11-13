/**
 * @file The QA kit's setup: one call builds a tester's throwaway root (layout
 *   in `kit.ts`). The root sits beside the tarball, so one `sweep` of the
 *   tarball's folder finds every tester's root. The stand-ins are copies, not
 *   links, so every process they start has the root in its argv, which is how
 *   `stop` finds them. Nothing here reads a credential.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * The file that marks a folder as a kit root; `commit`, `stop` and `sweep`
 * check it.
 */
export const ROOT_MARKER = ".ork-qa-root";

/** The identity of the kit's own commits (`kit.ts commit` uses it too). */
export const IDENTITY = [
  "-c",
  "user.name=ork-qa",
  "-c",
  "user.email=qa@invalid",
];

/** Variables that pick a paid provider; `env.sh` unsets them. */
const PAID_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../packages/runtime/test/fixtures",
);

/** Installs the tarball into the prefix. Injected in tests. */
export type Install = (prefix: string, tarball: string) => void;

/** The real install: the tarball's `ork` lands in `<prefix>/node_modules/.bin`. */
export const npmInstall: Install = (prefix, tarball) => {
  execFileSync(
    "npm",
    ["install", "--prefix", prefix, "--no-audit", "--no-fund", tarball],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
};

/** Whether `dir` is a kit root (holds the marker). */
export const isKitRoot = (dir: string): boolean =>
  existsSync(path.join(dir, ROOT_MARKER));

/** The environment of a git call that must not see the user's git setup. */
export const isolatedGitEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A hook's GIT_DIR and friends would point git at the wrong repository.
    if (!key.startsWith("GIT_")) {
      env[key] = value;
    }
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
};

/** Runs git in `cwd` with the kit's identity and no hooks or signing. */
export const kitGit = (cwd: string, args: readonly string[]): string =>
  execFileSync(
    "git",
    [
      ...IDENTITY,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, env: isolatedGitEnv(), encoding: "utf8" },
  );

/** `value` as one single-quoted shell word. */
const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const copyExecutable = (from: string, to: string): void => {
  copyFileSync(from, to);
  chmodSync(to, 0o755);
};

const envScript = (root: string): string =>
  [
    `export HOME=${quote(path.join(root, "home"))}`,
    `export PATH=${quote(path.join(root, "bin"))}:${quote(path.join(root, "prefix", "node_modules", ".bin"))}:"$PATH"`,
    "export ORK_NO_UPDATE_CHECK=1",
    `unset ${PAID_VARIABLES.join(" ")}`,
    "",
  ].join("\n");

/**
 * Makes `<root>/repos/starter`: one file, one commit, nothing from the user's
 * git setup.
 */
const makeStarter = (root: string): void => {
  const repo = path.join(root, "repos", "starter");
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, "README.md"), "# starter\n");
  kitGit(repo, ["init", "--quiet", "-b", "main"]);
  kitGit(repo, ["add", "-A"]);
  kitGit(repo, ["commit", "--quiet", "-m", "Start the starter repo"]);
};

/**
 * Builds the root `<dirname(tarball)>/<name>-XXXX/` and returns its realpath.
 *
 * @throws When `name` is not a plain name.
 */
export const setupKit = (
  tarball: string,
  name: string,
  install: Install = npmInstall,
): string => {
  if (!/^[\w.-]+$/u.test(name)) {
    throw new Error(`The name ${JSON.stringify(name)} is not a plain name.`);
  }
  const archive = path.resolve(tarball);
  const root = mkdtempSync(
    path.join(realpathSync(path.dirname(archive)), `${name}-`),
  );
  writeFileSync(path.join(root, ROOT_MARKER), "");
  mkdirSync(path.join(root, "home"));
  mkdirSync(path.join(root, "prefix"));
  mkdirSync(path.join(root, "bin"));
  copyExecutable(
    path.join(FIXTURES, "fake-claude.mjs"),
    path.join(root, "bin", "claude"),
  );
  copyExecutable(
    path.join(FIXTURES, "fake-command.mjs"),
    path.join(root, "bin", "cmd"),
  );
  const gh = path.join(root, "bin", "gh");
  writeFileSync(
    gh,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${quote(path.join(root, "gh.log"))}\nexit 1\n`,
  );
  chmodSync(gh, 0o755);
  writeFileSync(path.join(root, "env.sh"), envScript(root));
  makeStarter(root);
  install(path.join(root, "prefix"), archive);
  return root;
};
