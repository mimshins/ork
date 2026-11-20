/**
 * @file Fetching a remote `git.base` before a run resolves it (`git.fetch:
 *   auto`): only a remote-tracking ref such as `origin/main`, only that one
 *   branch into its own tracking ref, without tags, never prompting for
 *   credentials, and bounded by a timeout. A failure throws, with any
 *   `user:token@` taken out of the URLs in git's message.
 */

import { git, lines } from "./git.ts";

/** How long the fetch may take before the run fails. */
export const FETCH_TIMEOUT_MS = 60_000;

const REMOTES = "refs/remotes/";

/** The remote and branch `ref` tracks, or `undefined` for any other ref. */
const remoteRefOf = async (
  root: string,
  ref: string,
): Promise<{ remote: string; branch: string } | undefined> => {
  if (ref.startsWith("-")) return undefined;
  const full = await git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--symbolic-full-name",
    ref,
  ]);
  const name = full.stdout.trim();
  // A ref that resolves is what git says it is: a local branch, a tag or a
  // commit is never fetched, even when its name starts with a remote's.
  if (full.code === 0 && !name.startsWith(REMOTES)) return undefined;
  const rest =
    full.code === 0
      ? name.slice(REMOTES.length)
      : ref.replace(/^refs\/remotes\//u, "");
  const remotes = lines((await git(root, ["remote"])).stdout);
  const remote = remotes
    .filter(candidate => rest.startsWith(`${candidate}/`))
    .toSorted((a, b) => b.length - a.length)[0];
  if (remote === undefined) return undefined;
  const branch = rest.slice(remote.length + 1);
  // `origin/HEAD` names the remote's default branch, not a branch to fetch.
  return branch === "" || branch === "HEAD" ? undefined : { remote, branch };
};

/** `text` with the userinfo (`user:token@`) of every URL in it removed. */
export const redactUrls = (text: string): string =>
  text.replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, "$1");

/**
 * Fetches `ref` from its remote into its tracking ref when it names one; does
 * nothing for any other ref. Throws with git's reason when the fetch fails.
 */
export const fetchBase = async (root: string, ref: string): Promise<void> => {
  const target = await remoteRefOf(root, ref);
  if (target === undefined) return;
  const { remote, branch } = target;
  const result = await git(
    root,
    [
      "fetch",
      "--no-tags",
      remote,
      `+refs/heads/${branch}:${REMOTES}${remote}/${branch}`,
    ],
    { GIT_TERMINAL_PROMPT: "0" },
    FETCH_TIMEOUT_MS,
  );
  if (result.code === 0) return;
  const said = lines(result.stderr.trim());
  // git's "fatal:" line names the cause; the lines after it are advice.
  const reason =
    said.find(line => line.startsWith("fatal:")) ?? said.at(-1) ?? "";
  throw new Error(
    redactUrls(
      `git fetch ${remote} ${branch} failed: ${reason} (git.base is ${ref}; set git.fetch: never to skip the fetch)`,
    ),
  );
};
