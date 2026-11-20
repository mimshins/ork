/**
 * @file Tests for fetching a remote `git.base` (`git.fetch`): against a local
 *   bare remote, a remote-tracking base is fetched before it resolves, and only
 *   it; `never` and a resume (`fetch: false`) keep the last-fetched commit; a
 *   local branch, tag, commit or `HEAD` is never fetched; a failed fetch says
 *   why without the credentials in a URL.
 */

import path from "node:path";

import {
  DEFAULT_BRANCH_TEMPLATE,
  DEFAULT_WORKTREES_TEMPLATE,
  type ResolvedGitRules,
} from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { resolveBase } from "../src/index.ts";
import { redactUrls } from "../src/worktree/fetch.ts";
import { repo, sh, write } from "./fixtures/git.ts";

const rules = (
  base: string,
  fetch: "auto" | "never" = "auto",
): ResolvedGitRules => ({
  commit: "auto",
  merge: "auto",
  base,
  fetch,
  readonly: "checkout",
  branch: DEFAULT_BRANCH_TEMPLATE,
  worktrees: DEFAULT_WORKTREES_TEMPLATE,
});

const head = (cwd: string): string => sh(cwd, "rev-parse", "HEAD").trim();

/**
 * A clone with a bare `origin` whose `main` (and a `feature` branch this clone
 * never fetched) are one commit ahead of the clone's `origin/main`.
 */
const behindRemote = () => {
  const root = repo();
  const remote = path.join(path.dirname(root), "remote.git");
  sh(root, "clone", "-q", "--bare", root, remote);
  sh(root, "remote", "add", "origin", remote);
  sh(root, "fetch", "-q", "origin");
  const old = head(root);
  write(root, "new.txt", "new\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "new");
  const fresh = head(root);
  sh(root, "push", "-q", "origin", "HEAD:main", "HEAD:feature");
  sh(root, "update-ref", "refs/remotes/origin/main", old);
  sh(root, "update-ref", "-d", "refs/remotes/origin/feature");
  return { root, old, fresh };
};

/** The clone above, with a remote that any fetch fails to reach. */
const unreachable = (url = "/nowhere/missing.git") => {
  const setup = behindRemote();
  sh(setup.root, "remote", "set-url", "origin", url);
  return setup;
};

describe("a remote git.base", () => {
  it("is fetched before it resolves, in either spelling", async () => {
    const { root, fresh } = behindRemote();
    expect(await resolveBase(root, rules("origin/main"), {})).toBe(fresh);
    sh(root, "update-ref", "-d", "refs/remotes/origin/main");
    expect(await resolveBase(root, rules("refs/remotes/origin/main"), {})).toBe(
      fresh,
    );
  });

  it("is fetched when this clone never fetched that branch", async () => {
    const { root, fresh } = behindRemote();
    expect(await resolveBase(root, rules("origin/feature"), {})).toBe(fresh);
  });

  it("keeps the last-fetched commit under git.fetch: never or fetch: false", async () => {
    const { root, old } = behindRemote();
    expect(await resolveBase(root, rules("origin/main", "never"), {})).toBe(
      old,
    );
    expect(
      await resolveBase(root, rules("origin/main"), {}, { fetch: false }),
    ).toBe(old);
  });

  it("is the only kind of base fetched", async () => {
    const { root, old, fresh } = unreachable();
    sh(root, "tag", "v1", old);
    sh(root, "branch", "origin-feature", old);
    // A local branch that shadows the remote ref: git resolves the local one.
    sh(root, "branch", "origin/main", old);
    const bases = ["HEAD", "main", "v1", old, "origin-feature", "origin/main"];
    const resolved = await Promise.all(
      bases.map(base => resolveBase(root, rules(base), {})),
    );
    expect(resolved).toEqual([fresh, fresh, old, old, old, old]);
  });

  it("fails the run with git's reason when the fetch fails", async () => {
    const { root } = unreachable();
    await expect(resolveBase(root, rules("origin/main"), {})).rejects.toThrow(
      /^git fetch origin main failed: fatal: .+ \(git\.base is origin\/main; set git\.fetch: never to skip the fetch\)$/u,
    );
  });

  it("keeps a URL's credentials out of the failure", async () => {
    const { root } = unreachable("https://user:s3cret@127.0.0.1:9/x.git");
    const error = await resolveBase(root, rules("origin/main"), {}).catch(
      String,
    );
    expect(error).toContain("git fetch origin main failed");
    expect(error).not.toContain("s3cret");
    expect(
      redactUrls("fatal: unable to access 'https://user:s3cret@host/x.git/'"),
    ).toBe("fatal: unable to access 'https://host/x.git/'");
  });

  it("still says when the base is not a commit after the fetch", async () => {
    const { root } = behindRemote();
    await expect(
      resolveBase(root, rules("origin/nothing"), {}),
    ).rejects.toThrow(/^git fetch origin nothing failed: fatal: /u);
    await expect(resolveBase(root, rules("nothing"), {})).rejects.toThrow(
      /^git\.base is nothing, which is not a commit here$/u,
    );
  });
});
