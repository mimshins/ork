/**
 * @file Tests for the worktrees routes, on a temp git repository and a temp
 *   `~`: the list covers every project Ork knows, with core's words and what
 *   Remove… allows, and a project git can't read carries its error; Remove… and
 *   Clean merged… go ahead only with the digest of the plan shown, force only a
 *   plan that needed it, and never touch a run still going.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CallResult } from "../src/index.ts";
import { startTestServer, temp, type TestServer } from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** Records run `id` creating `branch` (at `folder`), finished unless `running`. */
const recordRun = (
  { store }: TestServer,
  root: string,
  id: string,
  created: { node: string; folder: string; branch: string },
  running = false,
): void => {
  store.begin({ id, workflow: "demo", file: "/w.ork.yaml", project: root });
  store.append(id, {
    type: "worktree",
    id: created.node,
    action: "created",
    path: created.folder,
    branch: created.branch,
  });
  if (running) return;
  store.append(id, {
    type: "run.finished",
    result: {
      runId: id,
      status: "succeeded",
      costUsd: 0,
      nodes: [],
      reasons: [],
      worktrees: [],
    },
  });
};

/** A registered repo `app` with a worktree on `ork/r1/lead`, run r1's. */
const withRepo = async (running = false) => {
  fixture = await startTestServer();
  const base = temp("ork-srv-wt-");
  const root = path.join(base, "app");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "dev@example.com");
  git(root, "config", "user.name", "Dev");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, "a.ts"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const lead = path.join(base, "ork-r1-lead");
  git(root, "worktree", "add", "--quiet", "-b", "ork/r1/lead", lead);
  fixture.store.addProject({ id: "app", root, mode: "attached", dir: base });
  recordRun(
    fixture,
    root,
    "r1",
    { node: "lead", folder: lead, branch: "ork/r1/lead" },
    running,
  );
  return { server: fixture, root, lead };
};

type Opened = Awaited<ReturnType<typeof withRepo>>;

/** A call's answer, or a throw with the server's refusal. */
const dataOf = <T>(answer: CallResult<T>): T => {
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
};

const planOf = async ({ server, root }: Opened, deleteBranch = false) =>
  dataOf(
    await server.client.call("worktreeRemovePlan", {
      body: { project: root, key: "ork/r1/lead", deleteBranch },
    }),
  );

const remove = (
  { server, root }: Opened,
  digest: string,
  extra: { force?: boolean; deleteBranch?: boolean } = {},
) =>
  server.client.call("worktreeRemove", {
    body: {
      project: root,
      key: "ork/r1/lead",
      deleteBranch: extra.deleteBranch ?? false,
      force: extra.force ?? false,
      digest,
    },
  });

describe("the worktrees list", () => {
  it("lists each project Ork knows, a project git can't read with its error", async () => {
    const { server, root, lead } = await withRepo();
    const { projects } = dataOf(await server.client.call("worktrees"));
    expect(projects.map(p => p.name)).toEqual(["app", "demo"]);
    const [app, demo] = projects;
    expect(app).toMatchObject({ root, head: "main" });
    expect(app?.items).toMatchObject([
      {
        key: "ork/r1/lead",
        label: "ork/r1/lead",
        state: "merged",
        path: lead,
        parts: [],
        run: { known: true, live: false },
        remove: { label: "Remove…" },
      },
    ]);
    expect(demo).toMatchObject({
      error: "Not in a git repository with a commit.",
      items: [],
    });
  });

  it("says a registered project's folder is gone, with the command that fixes it", async () => {
    const { server, root } = await withRepo();
    rmSync(root, { recursive: true });
    const { projects } = dataOf(
      await server.client.call("worktrees", { query: { project: root } }),
    );
    expect(projects[0]).toMatchObject({
      error: `its folder ${root} is gone.`,
      fix: "ork projects move app <new path>",
      items: [],
    });
  });

  it("keeps to one project, and only one Ork knows", async () => {
    const { server, root } = await withRepo();
    const one = dataOf(
      await server.client.call("worktrees", { query: { project: root } }),
    );
    expect(one.projects.map(p => p.name)).toEqual(["app"]);
    const other = await server.client.call("worktrees", {
      query: { project: "/nowhere" },
    });
    expect(other).toMatchObject({ ok: false, status: 404 });
  });

  it("says a live run's worktree can't be removed, by the remove route's rule", async () => {
    const opened = await withRepo(true);
    const answer = dataOf(
      await opened.server.client.call("worktrees", {
        query: { project: opened.root },
      }),
    );
    expect(answer.projects[0]?.items[0]?.remove).toEqual({
      label: "Remove…",
      refusal: "run r1 is still going; stop it first",
    });
    const plan = await opened.server.client.call("worktreeRemovePlan", {
      body: { project: opened.root, key: "ork/r1/lead", deleteBranch: false },
    });
    expect(plan).toEqual({
      ok: false,
      status: 400,
      error: "Can't remove ork/r1/lead: run r1 is still going; stop it first.",
    });
  });
});

describe("Remove…", () => {
  it("removes what it planned, and refuses a plan that changed since", async () => {
    const opened = await withRepo();
    const plan = await planOf(opened);
    expect(plan).toMatchObject({
      line: { text: "ork/r1/lead: remove worktree" },
      force: false,
    });
    writeFileSync(path.join(opened.lead, "wip.ts"), "wip\n");
    expect(await remove(opened, plan.digest)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(existsSync(opened.lead)).toBe(true);
  });

  it("forces only a plan that needed it, after showing what's lost", async () => {
    const opened = await withRepo();
    writeFileSync(path.join(opened.lead, "wip.ts"), "wip\n");
    const plan = await planOf(opened);
    expect(plan).toMatchObject({
      force: true,
      losing: { changes: ["?? wip.ts"], commits: [], commitsOn: null },
    });
    expect(await remove(opened, plan.digest)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await remove(opened, plan.digest, { force: true })).toEqual({
      ok: true,
      status: 200,
      data: { done: [`removed ${opened.lead}`] },
    });
  });
});

describe("Clean merged…", () => {
  it("cleans the merged plan it showed, and refuses one that changed", async () => {
    const opened = await withRepo();
    const { client } = opened.server;
    const body = { project: opened.root, branches: true };
    const plan = dataOf(await client.call("worktreesCleanPlan", { body }));
    const { digest } = plan;
    expect(plan.projects[0]?.steps).toMatchObject([
      {
        key: "ork/r1/lead",
        line: { text: "ork/r1/lead: remove worktree + delete branch" },
      },
    ]);
    git(opened.root, "branch", "ork/r2/docs");
    recordRun(opened.server, opened.root, "r2", {
      node: "docs",
      folder: "",
      branch: "ork/r2/docs",
    });
    expect(
      await client.call("worktreesClean", { body: { ...body, digest } }),
    ).toMatchObject({ ok: false, status: 409 });
    const again = dataOf(await client.call("worktreesCleanPlan", { body }));
    const cleaned = dataOf(
      await client.call("worktreesClean", {
        body: { ...body, digest: again.digest },
      }),
    );
    expect(cleaned.projects).toEqual([
      {
        root: opened.root,
        name: "app",
        done: [
          `removed ${opened.lead}`,
          "deleted ork/r1/lead",
          "deleted ork/r2/docs",
        ],
      },
    ]);
  });
});
