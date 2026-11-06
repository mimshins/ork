/**
 * @file Tests for the Feedback panel's routes: the items, dismissed ones too,
 *   and an item's records; dismiss and restore; accept as a lesson, written
 *   into the run's project; apply, started in the background as `ork feedback
 *   apply` with the run id it answers with; and publish, which sends only the
 *   post its preview showed.
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type FeedbackItem,
  type GhRunner,
  humanNoteEvent,
} from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { liveRun, startTestServer, type TestServer } from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** A server whose project (a repository) has a run noting `text` as `kind`. */
const noted = async (
  text: string,
  kind: "friction" | "bug" = "friction",
  gh?: GhRunner,
): Promise<{ server: TestServer; item: FeedbackItem }> => {
  fixture = await startTestServer(gh === undefined ? {} : { gh });
  mkdirSync(path.join(fixture.project.root, ".git"));
  liveRun(fixture, "run12345");
  fixture.store.append(
    "run12345",
    humanNoteEvent({ text, workflow: "demo", kind }),
  );
  const [item] = fixture.store.feedbackItems();
  if (item === undefined) throw new Error("No item.");
  return { server: fixture, item };
};

const params = (item: FeedbackItem) => ({ params: { id: item.id } });

/** A reply's data, failing the test when it was refused. */
const dataOf = <T>(
  reply: { ok: true; data: T } | { ok: false; error: string },
): T => {
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
};

describe("the items", () => {
  it("lists every item and shows one's records", async () => {
    const { server, item } = await noted("The brief was vague");
    expect(await server.client.call("feedbackItems", {})).toMatchObject({
      ok: true,
      data: [{ id: item.id, title: "The brief was vague" }],
    });
    expect(
      await server.client.call("feedbackItem", params(item)),
    ).toMatchObject({
      ok: true,
      data: { item: { id: item.id }, records: [{ runId: "run12345" }] },
    });
    expect(
      (await server.client.call("feedbackItem", { params: { id: "nope" } }))
        .status,
    ).toBe(404);
  });

  it("dismisses an item, keeps it listed, and restores it only then", async () => {
    const { server, item } = await noted("The brief was vague");
    const restore = { ...params(item), body: { status: "new" as const } };
    expect(await server.client.call("feedbackStatus", restore)).toMatchObject({
      ok: false,
      status: 409,
    });
    await server.client.call("feedbackStatus", {
      ...params(item),
      body: { status: "dismissed" },
    });
    expect(await server.client.call("feedbackItems", {})).toMatchObject({
      data: [{ status: "dismissed" }],
    });
    expect(await server.client.call("feedbackStatus", restore)).toMatchObject({
      ok: true,
      data: { status: "new" },
    });
  });
});

describe("accept and apply", () => {
  it("writes a lesson into the run's project, and says where", async () => {
    const { server, item } = await noted("Say where the spec is");
    const accepted = await server.client.call("accept", {
      ...params(item),
      body: { lesson: true },
    });
    expect(accepted).toMatchObject({
      ok: true,
      data: {
        item: { status: "accepted" },
        lesson: { file: ".ork/lessons/demo.md", workflow: "demo" },
      },
    });
    const file = path.join(server.project.root, ".ork", "lessons", "demo.md");
    expect(readFileSync(file, "utf8")).toContain("Say where the spec is");
  });

  it("starts `ork feedback apply` in the project, and refuses an `ork` item", async () => {
    const { server, item } = await noted("Say where the spec is");
    const applied = await server.client.call("apply", {
      ...params(item),
      body: {},
    });
    expect(applied).toMatchObject({
      ok: true,
      status: 202,
      data: { root: server.project.root },
    });
    const { argv, cwd } = server.lastArgs();
    expect(argv.slice(0, 3)).toEqual(["feedback", "apply", item.id]);
    expect(argv.at(-1)).toBe(dataOf(applied).runId);
    expect(cwd).toBe(server.project.root);
  });

  it("refuses to apply an item about Ork", async () => {
    const { server, item } = await noted("The tool crashed", "bug");
    expect(
      await server.client.call("apply", { ...params(item), body: {} }),
    ).toMatchObject({ ok: false, status: 409 });
  });
});

const answer = (data: unknown) =>
  Promise.resolve({ ok: true, stderr: "", stdout: JSON.stringify({ data }) });

/** A `gh` for a category with no threads yet, keeping what it was asked. */
const recordingGh = () => {
  const asked: string[] = [];
  const gh: GhRunner = args => {
    const query = String(args[3]);
    asked.push(query);
    if (query.includes("discussionCategory(")) {
      return answer({
        repository: { id: "R", discussionCategory: { id: "C" } },
      });
    }
    if (query.includes("createDiscussion")) {
      return answer({
        createDiscussion: { discussion: { url: "https://github.com/t/1" } },
      });
    }
    return answer({ repository: { discussions: { nodes: [] } } });
  };
  return {
    gh,
    asked: () => asked,
    sent: () => asked.filter(q => q.includes("mutation")),
  };
};

describe("publish", () => {
  it("sends only the post the preview showed", async () => {
    const fake = recordingGh();
    const { server, item } = await noted(
      "The tool crashed in demo",
      "bug",
      fake.gh,
    );
    const preview = await server.client.call("publishPreview", {
      ...params(item),
      body: { hideNames: false },
    });
    const { digest } = dataOf(preview);
    expect(preview).toMatchObject({
      data: {
        post: { title: "The tool crashed in demo" },
        plan: { kind: "create" },
      },
    });
    expect(
      await server.client.call("publish", {
        ...params(item),
        body: { hideNames: true, digest },
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(fake.sent()).toEqual([]);
    expect(
      await server.client.call("publish", {
        ...params(item),
        body: { hideNames: false, digest },
      }),
    ).toMatchObject({
      ok: true,
      data: { url: "https://github.com/t/1", item: { status: "published" } },
    });
    expect(fake.sent()).toHaveLength(1);
  });

  it("refuses an item that isn't about Ork, asking gh nothing", async () => {
    const fake = recordingGh();
    const { server, item } = await noted(
      "The brief was vague",
      "friction",
      fake.gh,
    );
    expect(
      await server.client.call("publishPreview", {
        ...params(item),
        body: { hideNames: false },
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(fake.asked()).toEqual([]);
  });
});

describe("an item's detail and split", () => {
  it("says what it allows, where a lesson goes, and its project", async () => {
    const { server, item } = await noted("Say where the spec is");
    expect(
      await server.client.call("feedbackItem", params(item)),
    ).toMatchObject({
      ok: true,
      data: {
        actions: {
          accept: { ok: true },
          lesson: { ok: true },
          apply: { ok: true },
          publish: { ok: false, why: "only feedback about Ork is shared" },
        },
        lessons: [
          {
            ok: true,
            workflow: "demo",
            file: ".ork/lessons/demo.md",
            tokens: 0,
            exists: false,
          },
        ],
        lessonCap: 1500,
        project: { ok: true, root: server.project.root },
      },
    });
  });

  it("refuses to split an item nothing was merged into", async () => {
    const { server, item } = await noted("Say where the spec is");
    expect(await server.client.call("split", params(item))).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});
