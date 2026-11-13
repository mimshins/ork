#!/usr/bin/env node
/**
 * @file The QA kit: repo tooling (not shipped) that gives a QA tester a
 *   throwaway world in one call. A root, `<dirname(tarball)>/<name>-XXXX/`,
 *   holds `.ork-qa-root` (the marker that makes a folder a kit root), `home/`
 *   (the tester's `HOME`, so its `ork` store is `home/.ork`), `prefix/` (the
 *   tarball installed, `prefix/node_modules/.bin/ork`), `bin/` (the stand-ins
 *   `claude` and `cmd`, copies of the runtime's fixtures, and `gh`, which logs
 *   its argv to `gh.log` in the root and exits 1), `repos/starter` (a git repo
 *   with one commit) and `env.sh` (sets `HOME`, `PATH` and
 *   `ORK_NO_UPDATE_CHECK=1`, unsets the paid-provider variables; start every
 *   Bash call with `. <root>/env.sh &&`). Each subcommand is one entry of
 *   `COMMANDS`: it returns the text to print or throws an `Error` whose message
 *   is printed. The subcommands:
 *
 *   - `setup <tarball> <name>` (`setup.ts`): builds a root.
 *   - `commit <repo> [message]` (`commit.ts`): commits everything in a repo with
 *     a fixed throwaway identity. It refuses a repo whose top level or common
 *     git folder is not inside a kit root under the temp folder, and refuses
 *     this project's checkout and its worktrees.
 *   - `stop <root>` (`stop.ts`): stops the live runs in the root's store (`ork
 *     ps`, `ork stop`), ends every process whose argv contains `<root>/`, and
 *     removes the root. Run it last, before reporting.
 *   - `sweep <dir>` (`stop.ts`): `stop` for every kit root in `<dir>`, then
 *     removes `<dir>` (`qa-pass`'s `sweep` step runs it on pack's folder).
 */

import { commitAll } from "./commit.ts";
import { setupKit } from "./setup.ts";
import { stopKit, sweepDir } from "./stop.ts";

type Command = (args: readonly string[]) => string;

const USAGE =
  "Usage: kit.ts setup <tarball> <name> | commit <repo> [message] | stop <root> | sweep <dir>";

const setup: Command = ([tarball, name]) => {
  if (tarball === undefined || name === undefined) {
    throw new Error(USAGE);
  }
  const root = setupKit(tarball, name);
  // A session's Bash keeps no exported variables between calls, so every call loads env.sh.
  return `Root: ${root}\nPrefix every command: . ${root}/env.sh && <command>`;
};

const commit: Command = ([repo, message]) => {
  if (repo === undefined) {
    throw new Error(USAGE);
  }
  return commitAll(repo, message);
};

const stop: Command = ([root]) => {
  if (root === undefined) {
    throw new Error(USAGE);
  }
  return stopKit(root);
};

const sweep: Command = ([dir]) => {
  if (dir === undefined) {
    throw new Error(USAGE);
  }
  return sweepDir(dir);
};

/** The subcommands, each in its own module. */
const COMMANDS: Record<string, Command> = { setup, commit, stop, sweep };

if (import.meta.main) {
  const [name = "", ...args] = process.argv.slice(2);
  try {
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (command === undefined) {
      throw new Error(USAGE);
    }
    console.log(command(args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
