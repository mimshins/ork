/**
 * @file Tests for the follow-ups routes: a project's list after the due check
 *   (a fake `gh` shows a PR merged; a `gh` that fails only reports), one
 *   follow-up with what to copy and what can be done to it, done, drop, reopen
 *   and due with their refusals, a github-channel post only with the person's
 *   confirmation of its exact text, and the overview stream's due follow-ups.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  type FollowUp,
  followUpStore,
  type GhResult,
  type GhRunner,
  type NewFollowUp,
} from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  liveRun,
  readSse,
  text,
  startTestServer,
  type SseEvent,
  type TestServer,
} from "./fixtures.ts";

let fixture: TestServer | undefined;
const stops: AbortController[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop.abort();
  await fixture?.close();
  fixture = undefined;
});

const ghOk = (stdout: string): GhResult => ({ ok: true, stdout, stderr: "" });

/** A `gh` that knows one merged PR, takes comments, and fails on the rest. */
const merged: { calls: string[]; gh: GhRunner } = {
  calls: [],
  gh: args => {
    merged.calls.push(args.join(" "));
    if (args[0] === "pr" && args[1] === "view") {
      return Promise.resolve(ghOk('{"state":"MERGED"}'));
    }
    if (args[0] === "pr" && args[1] === "comment") {
      return Promise.resolve(ghOk("https://github.com/acme/app/pull/7#c1\n"));
    }
    return Promise.resolve({ ok: false, stdout: "", stderr: "not found" });
  },
};

const signedOut: GhRunner = () =>
  Promise.resolve({ ok: false, stdout: "", stderr: "gh: not logged in" });

const serve = async (gh: GhRunner = merged.gh): Promise<TestServer> => {
  merged.calls = [];
  fixture = await startTestServer({ gh });
  return fixture;
};

const add = async (
  server: TestServer,
  input: Partial<NewFollowUp> & { title: string },
): Promise<FollowUp> =>
  (
    await followUpStore({
      rows: server.store,
      project: server.project.root,
      home: server.home,
    }).add({ for: "me", kind: "task", due: "now", ...input })
  ).followUp;

const list = (server: TestServer, query: { status?: "all" | "done" } = {}) =>
  server.client.call("followUps", { params: { id: "demo" }, query });

const detail = (server: TestServer, id: string) =>
  server.client.call("followUp", { params: { id: "demo", followUp: id } });

const change = (
  server: TestServer,
  id: string,
  action: "done" | "drop" | "reopen" | "due",
) =>
  server.client.call("followUpChange", {
    params: { id: "demo", followUp: id },
    body: { action },
  });

const post = (server: TestServer, id: string, digest: string) =>
  server.client.call("followUpPost", {
    params: { id: "demo", followUp: id },
    body: { confirm: true, digest },
  });

/** The digest of the draft a person saw. */
const digestOf = async (server: TestServer, id: string): Promise<string> => {
  const shown = await detail(server, id);
  return shown.ok ? (shown.data.draftDigest ?? "") : "";
};

const titlesOf = (listed: Awaited<ReturnType<typeof list>>): string[] =>
  listed.ok ? listed.data.followUps.map(f => f.title) : [];

const lastData = (seen: SseEvent[], event: string): unknown =>
  seen.findLast(e => e.event === event)?.data;

const openStream = async (server: TestServer, target: string) => {
  const stop = new AbortController();
  stops.push(stop);
  const response = await server.get(target);
  return readSse(response, stop.signal);
};

const names = (seen: SseEvent[]) => seen.map(e => e.event);

const checkerOf = (
  listed: Awaited<ReturnType<typeof list>>,
): { available: boolean; errors: string[] } =>
  listed.ok ? listed.data.checker : { available: true, errors: [] };

const PR = "https://github.com/acme/app/pull/7";

const githubDraft = (server: TestServer) =>
  add(server, {
    title: "Reply on the PR",
    for: "person:partner",
    kind: "message",
    draft: { to: PR, channel: "github", text: "The API moved." },
  });

describe("GET /api/projects/:id/follow-ups", () => {
  it("lists a project's open follow-ups, oldest first, with the due count", async () => {
    const server = await serve();
    await add(server, { title: "Check the dashboards", kind: "check" });
    await add(server, {
      title: "Add retries",
      for: "agent",
      kind: "change",
      due: "after-merge",
    });
    const listed = await list(server);
    expect(listed).toMatchObject({
      ok: true,
      data: {
        project: server.project.root,
        due: 1,
        checker: { available: true, errors: [] },
        followUps: [
          { title: "Check the dashboards", status: "due" },
          { title: "Add retries", status: "waiting" },
        ],
      },
    });
  });

  it("hides closed ones until asked, and filters by status and for", async () => {
    const server = await serve();
    const one = await add(server, { title: "Check it" });
    await change(server, one.id, "done");
    await add(server, { title: "Ask Dana", for: "agent", kind: "change" });
    const open = await list(server);
    expect(titlesOf(open)).toEqual(["Ask Dana"]);
    const all = await list(server, { status: "all" });
    expect(titlesOf(all)).toEqual(["Check it", "Ask Dana"]);
    const done = await list(server, { status: "done" });
    expect(titlesOf(done)).toEqual(["Check it"]);
    const forAgent = await server.client.call("followUps", {
      params: { id: "demo" },
      query: { status: "all", for: "agent" },
    });
    expect(titlesOf(forAgent)).toEqual(["Ask Dana"]);
  });

  it("makes an after-merge follow-up due when gh shows its PR merged", async () => {
    const server = await serve();
    await add(server, {
      title: "Add retries",
      for: "agent",
      kind: "change",
      due: "after-merge",
      ref: PR,
    });
    const listed = await list(server);
    expect(listed).toMatchObject({
      ok: true,
      data: { due: 1, followUps: [{ status: "due" }] },
    });
    expect(merged.calls).toContain(`pr view ${PR} --json state`);
  });

  it("reports a gh that fails, and leaves the follow-up waiting", async () => {
    const server = await serve(signedOut);
    await add(server, {
      title: "Add retries",
      for: "agent",
      kind: "change",
      due: "after-merge",
      ref: "feature",
    });
    const listed = await list(server);
    expect(listed).toMatchObject({
      ok: true,
      data: { due: 0, followUps: [{ status: "waiting" }] },
    });
    expect(checkerOf(listed)).toMatchObject({ available: false });
    expect(checkerOf(listed).errors).toHaveLength(1);
  });

  it("refuses a project that isn't registered", async () => {
    const server = await serve();
    expect(
      await server.client.call("followUps", {
        params: { id: "ghost" },
        query: {},
      }),
    ).toEqual({
      ok: false,
      status: 404,
      error: "No registered project `ghost`.",
    });
  });
});

describe("GET /api/projects/:id/follow-ups/:followUp", () => {
  it("gives a draft's text and a task's commands to copy, by prefix too", async () => {
    const server = await serve();
    const message = await add(server, {
      title: "Tell Dana",
      for: "person:Dana",
      kind: "message",
      draft: { to: "Dana", channel: "slack", text: "Line one\nLine two" },
    });
    const task = await add(server, {
      title: "Cut over",
      steps: [
        { text: "Back up" },
        { text: "Switch", command: "kubectl rollout restart deploy/app" },
        { text: "Verify", command: "curl -f /health" },
      ],
    });
    expect(await detail(server, message.id.slice(0, 3))).toMatchObject({
      ok: true,
      data: {
        followUp: { id: message.id },
        copy: { text: "Line one\nLine two", commands: [] },
        actions: {
          done: { ok: true },
          drop: { ok: true },
          reopen: { ok: false, why: "it is due" },
          due: { ok: false, why: "it is due" },
          post: { ok: false, why: "not drafted for the github channel" },
        },
        keptIn: { place: "store", rule: "store" },
        draftDigest: text(),
      },
    });
    expect(await detail(server, task.id)).toMatchObject({
      ok: true,
      data: {
        copy: {
          text: "",
          commands: ["kubectl rollout restart deploy/app", "curl -f /health"],
        },
      },
    });
  });

  it("allows a post only for an open github-channel message", async () => {
    const server = await serve();
    const draft = await githubDraft(server);
    expect(await detail(server, draft.id)).toMatchObject({
      ok: true,
      data: { actions: { post: { ok: true } } },
    });
  });

  it("says when there is no such follow-up", async () => {
    const server = await serve();
    expect(await detail(server, "nope")).toEqual({
      ok: false,
      status: 404,
      error: "No follow-up `nope` in this project.",
    });
  });
});

describe("what a detail says of a follow-up", () => {
  it("says why it is due: merged, overdue, closed unmerged or marked", async () => {
    const server = await serve();
    const one = await add(server, {
      title: "Add retries",
      due: "after-merge",
      ref: PR,
    });
    await list(server);
    expect(await detail(server, one.id)).toMatchObject({
      ok: true,
      data: { cause: "merged", followUp: { note: `${PR} merged` } },
    });
    const dated = await add(server, {
      title: "Renew the cert",
      due: "2020-01-01",
    });
    await list(server);
    expect(await detail(server, dated.id)).toMatchObject({
      data: { cause: "overdue" },
    });
    const closed = await add(server, {
      title: "Old PR",
      due: "after-merge",
      ref: "gone",
    });
    server.store.putFollowUp({
      ...closed,
      status: "due",
      note: "gone was closed without merging; decide whether it still applies",
    });
    expect(await detail(server, closed.id)).toMatchObject({
      data: { cause: "closed-unmerged" },
    });
  });

  it("says where it is kept, and why that isn't where the rule says", async () => {
    const server = await serve();
    writeFileSync(
      path.join(server.project.root, ".ork", "project.yaml"),
      "schemaVersion: 1\nfollowUps:\n  store: github\n",
    );
    const fellBack = await add(server, { title: "Needs an issue" });
    expect(await detail(server, fellBack.id)).toMatchObject({
      ok: true,
      data: {
        keptIn: {
          place: "store",
          rule: "github",
          fallback: text("GitHub couldn't be used"),
        },
      },
    });
  });

  it("says where one for another project went, and its live run", async () => {
    const server = await serve();
    liveRun(server, "r9");
    const sent = await add(server, {
      title: "Update the SDK",
      for: "project:demo",
      kind: "change",
    });
    expect(await detail(server, sent.id)).toMatchObject({
      ok: true,
      data: {
        delivery: {
          project: "demo",
          registered: true,
          root: server.project.root,
          keptIn: "store",
          live: { run: "r9", node: "lead" },
        },
      },
    });
  });

  it("says a project it was for is not registered", async () => {
    const server = await serve();
    const lost = await add(server, {
      title: "Lost one",
      for: "project:ghost",
      kind: "change",
    });
    expect(await detail(server, lost.id)).toMatchObject({
      data: { delivery: { project: "ghost", registered: false } },
    });
  });

  it("explains every refused action", async () => {
    const server = await serve();
    const one = await add(server, { title: "Check it" });
    await change(server, one.id, "done");
    expect(await detail(server, one.id)).toMatchObject({
      data: {
        actions: {
          done: {
            ok: false,
            why: "it is done",
            error: `${one.id} is done, so it can't be done.`,
          },
          drop: { ok: false },
          due: { ok: false },
          reopen: { ok: true },
        },
      },
    });
  });
});

describe("POST /api/projects/:id/follow-ups/:followUp", () => {
  it("marks done, drops, reopens and makes due, each answering the new detail", async () => {
    const server = await serve();
    const waiting = await add(server, {
      title: "After deploy",
      due: "after-deploy",
    });
    expect(await change(server, waiting.id, "due")).toMatchObject({
      ok: true,
      data: {
        followUp: { status: "due" },
        actions: {
          done: { ok: true },
          reopen: { ok: false },
          due: { ok: false },
        },
        cause: "marked",
      },
    });
    expect(await change(server, waiting.id, "done")).toMatchObject({
      ok: true,
      data: { followUp: { status: "done" }, actions: { reopen: { ok: true } } },
    });
    expect(await change(server, waiting.id, "reopen")).toMatchObject({
      ok: true,
      data: { followUp: { status: "waiting" } },
    });
    expect(await change(server, waiting.id, "drop")).toMatchObject({
      ok: true,
      data: { followUp: { status: "dropped" } },
    });
    expect(server.store.followUp(server.project.root, waiting.id)?.status).toBe(
      "dropped",
    );
  });

  it("refuses an action the status doesn't allow, with the CLI's text", async () => {
    const server = await serve();
    const one = await add(server, { title: "Check it" });
    await change(server, one.id, "done");
    expect(await change(server, one.id, "done")).toEqual({
      ok: false,
      status: 409,
      error: `${one.id} is done, so it can't be done.`,
    });
    expect((await change(server, one.id, "due")).ok).toBe(false);
  });

  it("refuses an action the contract doesn't know", async () => {
    const server = await serve();
    const one = await add(server, { title: "Check it" });
    const response = await fetch(
      `${server.server.url}/api/projects/demo/follow-ups/${one.id}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "send" }),
      },
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/projects/:id/follow-ups/:followUp/post", () => {
  it("posts the confirmed draft through gh, and the follow-up is done", async () => {
    const server = await serve();
    const draft = await githubDraft(server);
    const posted = await post(
      server,
      draft.id,
      await digestOf(server, draft.id),
    );
    expect(posted).toMatchObject({
      ok: true,
      data: {
        url: "https://github.com/acme/app/pull/7#c1",
        followUp: { followUp: { status: "done" } },
      },
    });
    expect(merged.calls).toContain(`pr comment ${PR} --body The API moved.`);
  });

  it("refuses when the draft is no longer the one that was confirmed, posting nothing", async () => {
    const server = await serve();
    const draft = await githubDraft(server);
    const refused = await post(server, draft.id, "a-stale-digest");
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(merged.calls.filter(call => call.includes("comment"))).toEqual([]);
    expect(server.store.followUp(server.project.root, draft.id)?.status).toBe(
      "due",
    );
  });

  it("refuses without a confirmation, and a message for another channel", async () => {
    const server = await serve();
    const draft = await githubDraft(server);
    const response = await fetch(
      `${server.server.url}/api/projects/demo/follow-ups/${draft.id}/post`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirm: false, digest: "x" }),
      },
    );
    expect(response.status).toBe(400);
    const slack = await add(server, {
      title: "Tell Dana",
      for: "person:Dana",
      kind: "message",
      draft: { to: "Dana", channel: "slack", text: "Hi" },
    });
    expect(
      await post(server, slack.id, await digestOf(server, slack.id)),
    ).toMatchObject({
      ok: false,
      status: 409,
      error: text("only a message drafted for the github channel"),
    });
    expect(merged.calls.filter(call => call.includes("comment"))).toEqual([]);
  });

  it("does not post a message that is already done", async () => {
    const server = await serve();
    const draft = await githubDraft(server);
    await change(server, draft.id, "done");
    expect(
      await post(server, draft.id, await digestOf(server, draft.id)),
    ).toMatchObject({
      ok: false,
      status: 409,
      error: text("is done"),
    });
    expect(merged.calls.filter(call => call.includes("comment"))).toEqual([]);
  });
});

describe("the overview stream's due follow-ups", () => {
  it("says nothing when none is due, then sends the count and the items", async () => {
    const server = await serve();
    const stream = await openStream(server, "/api/stream");
    await expect.poll(() => names(stream.seen)).toContain("version");
    expect(names(stream.seen)).not.toContain("followUps");
    const one = await add(server, { title: "Check the dashboards" });
    await expect
      .poll(() => names(stream.seen), { timeout: 3000 })
      .toContain("followUps");
    expect(stream.seen.find(e => e.event === "followUps")?.data).toEqual({
      count: 1,
      items: [
        {
          id: one.id,
          project: server.project.root,
          title: "Check the dashboards",
          for: "me",
          kind: "task",
        },
      ],
    });
  });

  it("sends the empty count again when the last one is closed", async () => {
    const server = await serve();
    const one = await add(server, { title: "Check it" });
    const stream = await openStream(server, "/api/stream");
    await expect.poll(() => names(stream.seen)).toContain("followUps");
    await change(server, one.id, "done");
    await expect
      .poll(() => stream.seen.filter(e => e.event === "followUps").length, {
        timeout: 3000,
      })
      .toBe(2);
    expect(lastData(stream.seen, "followUps")).toEqual({
      count: 0,
      items: [],
    });
  });
});
