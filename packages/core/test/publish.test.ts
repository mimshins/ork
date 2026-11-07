/**
 * @file Tests for sharing feedback about Ork (ADR-059): what redaction takes
 *   out and what it leaves, the post and its marker, and the Discussions client
 *   on a fake `gh`: planning only reads, a thread with the marker gets a "+1",
 *   a new one starts otherwise, and failures say why.
 */

import { describe, expect, it } from "vitest";

import {
  type FeedbackItem,
  type FeedbackRecord,
  type GhRunner,
  planPost,
  THREADS_SEARCHED,
  publishPost,
  redact,
  sendPost,
} from "../src/index.ts";

const OPTIONS = { roots: ["/Users/ann/code/acme"], home: "/Users/ann" };

describe("redaction", () => {
  it("takes out paths, people, hosts and secrets", () => {
    expect(
      redact(
        [
          "Failed in /Users/ann/code/acme/src/app.ts",
          "and /Users/ann/.ork/state.db, and /home/bob/x",
          "mail ann@acme.com, see https://ci.acme.internal:8443/job/1",
          "at 10.0.0.12 and build.acme.io",
          "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        ].join("\n"),
        OPTIONS,
      ),
    ).toBe(
      [
        "Failed in <project>/src/app.ts",
        "and ~/.ork/state.db, and ~/x",
        "mail <email>, see https://<host>/job/1",
        "at <ip> and <host>",
        "token [masked]",
      ].join("\n"),
    );
  });

  it("leaves file names, GitHub links and words alone", () => {
    const text =
      "AGENTS.md, package.json and nodes.spec.output; see https://github.com/mimshins/ork/issues/1";
    expect(redact(text, OPTIONS)).toBe(text);
  });

  it("hides names only when asked", () => {
    expect(
      redact("acme's release workflow failed", {
        ...OPTIONS,
        names: ["acme", "release"],
      }),
    ).toBe("<name>'s <name> workflow failed");
    expect(redact("acme failed", OPTIONS)).toBe("acme failed");
  });
});

const ITEM: FeedbackItem = {
  id: "abcdef0123456789",
  merged: [],
  status: "triaged",
  title: "The bash tool crashed in /Users/ann/code/acme",
  target: "ork",
  kind: "bug",
  severity: "high",
  sources: ["agent"],
  count: 3,
  firstSeen: "2026-01-01",
  lastSeen: "2026-01-02",
  runs: ["r1", "r2"],
  workflows: ["release"],
  models: ["sonnet"],
};

const RECORD: FeedbackRecord = {
  id: 1,
  runId: "r2",
  seq: 4,
  at: "2026-01-02",
  feedback: {
    source: "agent",
    kind: "bug",
    target: "ork",
    severity: "high",
    title: ITEM.title,
    body: "It exited 137 reading /Users/ann/code/acme/big.log",
    evidence: [],
    fingerprint: ITEM.id,
    origin: {
      version: "0.4.0",
      driver: "cli",
      model: "sonnet",
      nodeType: "claude.worker",
    },
  },
};

describe("the post", () => {
  it("has a header, the newest words quoted, and a hidden marker", () => {
    const post = publishPost(ITEM, [RECORD], OPTIONS);
    expect(post.title).toBe("The bash tool crashed in <project>");
    expect(post.body).toBe(
      [
        "**Ork** 0.4.0 · **driver** cli · **model** sonnet · **node** claude.worker · **kind** bug · **seen** 3 time(s) in 2 run(s)",
        "",
        "> It exited 137 reading <project>/big.log",
        "",
        "<sub>Shared with `ork feedback publish`.</sub>",
        "<!-- ork-fingerprint: abcdef0123456789 -->",
      ].join("\n"),
    );
    expect(post.comment).toMatch(/^\+1 · \*\*Ork\*\* 0\.4\.0/u);
    expect(post.comment).not.toContain("ork-fingerprint");
  });
});

/** A `gh` that answers each call in turn, recording what it was asked. */
const fakeGh = (answers: readonly unknown[]) => {
  const calls: string[][] = [];
  const gh: GhRunner = args => {
    calls.push([...args]);
    const answer = answers[calls.length - 1];
    return Promise.resolve(
      typeof answer === "string"
        ? { ok: false, stdout: "", stderr: answer }
        : { ok: true, stdout: JSON.stringify({ data: answer }), stderr: "" },
    );
  };
  return { gh, calls };
};

const PLACE = {
  repository: { id: "R1", discussionCategory: { id: "C1" } },
};
const threads = (...bodies: string[]) => ({
  repository: {
    discussions: {
      nodes: bodies.map((body, i) => ({
        id: `D${String(i)}`,
        url: `https://github.com/mimshins/ork/discussions/${String(i)}`,
        body,
      })),
    },
  },
});

const post = publishPost(ITEM, [RECORD], OPTIONS);

/** One page of threads, with more after it. */
const page = (cursor: string, ...bodies: string[]) => ({
  repository: {
    discussions: {
      ...threads(...bodies).repository.discussions,
      pageInfo: { hasNextPage: true, endCursor: cursor },
    },
  },
});

describe("the Discussions client", () => {
  it("plans a new thread by reading only, then creates it", async () => {
    const { gh, calls } = fakeGh([
      PLACE,
      threads("something else"),
      {
        createDiscussion: {
          discussion: { url: "https://github.com/mimshins/ork/discussions/9" },
        },
      },
    ]);
    const planned = await planPost(post, gh);
    expect(planned).toEqual({
      ok: true,
      plan: { kind: "create", repo: "R1", cat: "C1" },
    });
    expect(calls.map(args => String(args[3]).slice(0, 12))).toEqual([
      "query=query(",
      "query=query(",
    ]);
    expect(calls[0]).toContain("slug=agent-feedback");
    expect(
      await sendPost(post, { kind: "create", repo: "R1", cat: "C1" }, gh),
    ).toEqual({
      ok: true,
      url: "https://github.com/mimshins/ork/discussions/9",
      kind: "created",
    });
    expect(calls[2]).toContain(`body=${post.body}`);
  });

  it("comments +1 on the thread that carries the item's marker", async () => {
    const { gh, calls } = fakeGh([
      PLACE,
      threads("other", "x <!-- ork-fingerprint: abcdef0123456789 -->"),
      {
        addDiscussionComment: {
          comment: { url: "https://github.com/mimshins/ork/discussions/1#c" },
        },
      },
    ]);
    const planned = await planPost(post, gh);
    expect(planned).toEqual({
      ok: true,
      plan: {
        kind: "comment",
        thread: "D1",
        url: "https://github.com/mimshins/ork/discussions/1",
      },
    });
    expect(
      await sendPost(post, { kind: "comment", thread: "D1", url: "u" }, gh),
    ).toMatchObject({ ok: true, kind: "commented" });
    expect(calls[2]).toContain(`body=${post.comment}`);
  });

  it("pages through the category for the marker, after each page's cursor", async () => {
    const { gh, calls } = fakeGh([
      PLACE,
      page("P1", "first"),
      page("P2", "x <!-- ork-fingerprint: abcdef0123456789 -->"),
    ]);
    expect(await planPost(post, gh)).toMatchObject({
      ok: true,
      plan: { kind: "comment", thread: "D0" },
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]).not.toContain("after=P1");
    expect(calls[2]).toContain("after=P1");
  });

  it("stops at THREADS_SEARCHED and starts a thread", async () => {
    const pages = THREADS_SEARCHED / 100;
    const endless = Array.from({ length: pages + 1 }, (_, i) => ({
      repository: {
        discussions: {
          nodes: [{ id: "D", url: "u", body: "other" }],
          pageInfo: { hasNextPage: true, endCursor: `P${String(i)}` },
        },
      },
    }));
    const { gh, calls } = fakeGh([PLACE, ...endless]);
    expect(await planPost(post, gh)).toMatchObject({
      ok: true,
      plan: { kind: "create" },
    });
    expect(calls).toHaveLength(1 + pages);
  });

  it("says why when gh fails or the category isn't there", async () => {
    expect(await planPost(post, fakeGh(["not logged in"]).gh)).toEqual({
      ok: false,
      error: "gh failed: not logged in",
    });
    expect(
      await planPost(
        post,
        fakeGh([{ repository: { id: "R1", discussionCategory: null } }]).gh,
      ),
    ).toEqual({
      ok: false,
      error:
        "No `agent-feedback` category in the Discussions of `mimshins/ork`.",
    });
  });
});
