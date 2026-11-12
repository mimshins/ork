/**
 * @file Tests for follow-ups: the `followUps` project rule, the store index
 *   (add, list, get, status), duplicates merging, scrubbing, and each place
 *   adapter: Ork's store, a markdown file in the worktree, and GitHub issues
 *   through a fake `gh`, with its fallback to the store.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectSchema } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type FollowUpStoreOptions,
  followUpStore,
  type GhResult,
  type GhRunner,
  nearTitle,
  type NewFollowUp,
  openStore,
} from "../src/index.ts";

const PROJECT = "/work/se-backend";
const HOME = "/Users/someone";

const ids = () => {
  let next = 0;
  return () => {
    next += 1;
    return `fu${String(next)}`;
  };
};

const storeWith = (options: Partial<FollowUpStoreOptions> = {}) =>
  followUpStore({
    rows: openStore(":memory:"),
    project: PROJECT,
    home: HOME,
    now: () => "2026-11-12T10:00:00.000Z",
    newId: ids(),
    ...options,
  });

const change: NewFollowUp = {
  title: "Add retries to the billing client",
  body: "The client gives up on the first 503.",
  for: "agent",
  kind: "change",
  due: "after-merge",
  where: ["src/billing.ts"],
  from: { run: "r1", node: "build" },
  ref: "https://github.com/acme/se-backend/pull/7",
};

const message: NewFollowUp = {
  title: "Tell the partner the API moved",
  for: "person:Dana",
  kind: "message",
  due: "now",
  draft: { to: "Dana", channel: "email", text: "The v2 API is live." },
};

/** A `gh` answering each call from `answer`, recording the arguments. */
const fakeGh = (answer: (args: readonly string[]) => GhResult) => {
  const calls: { args: readonly string[]; cwd: string | undefined }[] = [];
  const gh: GhRunner = (args, options) => {
    calls.push({ args, cwd: options?.cwd });
    return Promise.resolve(answer(args));
  };
  return { gh, calls };
};

const ok = (stdout = ""): GhResult => ({ ok: true, stdout, stderr: "" });
const failed = (stderr: string): GhResult => ({
  ok: false,
  stdout: "",
  stderr,
});

const signedIn = (args: readonly string[]): GhResult =>
  args[0] === "issue"
    ? ok("Creating issue\nhttps://github.com/acme/se-backend/issues/12\n")
    : ok();

const refusesIssues = (args: readonly string[]): GhResult =>
  args[0] === "issue" ? failed("HTTP 403") : ok();

const tempDir = () => mkdtempSync(path.join(tmpdir(), "ork-follow-ups-"));

describe("the followUps project rule", () => {
  it("takes a place, a file and a label", () => {
    const project = {
      schemaVersion: 1,
      followUps: { store: "github", label: "later" },
    };
    expect(ProjectSchema.parse(project).followUps).toEqual({
      store: "github",
      label: "later",
    });
  });

  it("refuses a place it doesn't know", () => {
    const project = { schemaVersion: 1, followUps: { store: "jira" } };
    expect(ProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe("followUpStore with Ork's store", () => {
  it("keeps a follow-up, waiting until its due, and lists it", async () => {
    const store = storeWith();
    const added = await store.add(change);
    expect(added).toMatchObject({ merged: false, followUp: { id: "fu1" } });
    expect(store.get("fu1")).toEqual({
      ...change,
      id: "fu1",
      project: PROJECT,
      status: "waiting",
      place: "store",
      createdAt: "2026-11-12T10:00:00.000Z",
      updatedAt: "2026-11-12T10:00:00.000Z",
    });
    expect(store.place).toBe("store");
  });

  it("makes a follow-up due now due at once, and filters by status", async () => {
    const store = storeWith();
    await store.add(change);
    await store.add(message);
    expect(store.list({ status: ["due"] }).map(f => f.title)).toEqual([
      message.title,
    ]);
    expect(store.list().length).toBe(2);
  });

  it("changes a status with a note, and says when there is no such id", async () => {
    const store = storeWith();
    await store.add(change);
    expect(store.setStatus("fu1", "due", "PR closed unmerged")).toMatchObject({
      status: "due",
      note: "PR closed unmerged",
    });
    expect(store.setStatus("nope", "done")).toBeUndefined();
  });

  it("keeps each project's follow-ups apart", async () => {
    const rows = openStore(":memory:");
    await storeWith({ rows }).add(change);
    expect(storeWith({ rows, project: "/work/other" }).list()).toEqual([]);
  });
});

describe("duplicate follow-ups", () => {
  it("merge when added at the same time", async () => {
    const { gh } = fakeGh(signedIn);
    const store = storeWith({ rule: { store: "github" }, gh });
    const both = await Promise.all([store.add(change), store.add(change)]);
    expect(both.map(added => added.merged)).toEqual([false, true]);
    expect(store.list().length).toBe(1);
    expect(store.list()[0]?.place).toBe("github");
  });

  it("merge into the open one for the same for, files and a near title", async () => {
    const store = storeWith();
    await store.add(change);
    const again = await store.add({
      ...change,
      title: "Add retries to billing client",
      body: "Also on 429.",
    });
    expect(again).toMatchObject({ merged: true, followUp: { id: "fu1" } });
    expect(store.list().map(f => f.body)).toEqual([
      "The client gives up on the first 503.\n\nAlso on 429.",
    ]);
  });

  it("stay apart for someone else, other files, or a closed one", async () => {
    const store = storeWith();
    await store.add(change);
    await store.add({ ...change, for: "me" });
    await store.add({ ...change, where: ["src/other.ts"] });
    store.setStatus("fu1", "done");
    await store.add(change);
    expect(store.list().map(f => f.id)).toEqual(["fu1", "fu2", "fu3", "fu4"]);
  });

  it("compare titles by their words", () => {
    expect(nearTitle("Update the docs", "update docs!")).toBe(false);
    expect(
      nearTitle("Ping Dana about the v2 API", "ping dana about v2 API"),
    ).toBe(true);
  });
});

describe("scrubbing", () => {
  it("takes paths, emails and secrets out of the text before keeping it", async () => {
    const store = storeWith();
    const { followUp } = await store.add({
      ...message,
      body: `See ${PROJECT}/src/a.ts and ${HOME}/notes.md`,
      draft: {
        to: "dana@partner.example.com",
        text: "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      },
      steps: [{ text: "Check", command: `cat ${HOME}/.aws/config` }],
    });
    expect(followUp.body).toBe("See <project>/src/a.ts and ~/notes.md");
    expect(followUp.draft?.to).toBe("<email>");
    expect(followUp.draft?.text).not.toContain("abcdefghijklmnop");
    expect(followUp.steps).toEqual([
      { text: "Check", command: "cat ~/.aws/config" },
    ]);
  });
});

describe("the file store", () => {
  it("appends each new follow-up to .ork/follow-ups.md in the worktree", async () => {
    const worktree = tempDir();
    const store = storeWith({ rule: { store: "file" }, worktree });
    await store.add(change);
    const { followUp } = await store.add(message);
    const text = readFileSync(
      path.join(worktree, ".ork/follow-ups.md"),
      "utf8",
    );
    expect(followUp).toMatchObject({
      place: "file",
      url: ".ork/follow-ups.md",
    });
    expect(text.match(/^# Follow-ups/gmu)?.length).toBe(1);
    expect(text).toContain("## Add retries to the billing client");
    expect(text).toContain("> The v2 API is live.");
  });

  it("writes the rule's file, and not a merged duplicate again", async () => {
    const worktree = tempDir();
    const store = storeWith({
      rule: { store: "file", file: "docs/later.md" },
      worktree,
    });
    await store.add(change);
    await store.add(change);
    const text = readFileSync(path.join(worktree, "docs/later.md"), "utf8");
    expect(text.split("## Add retries").length).toBe(2);
  });

  it("keeps it in Ork's store, and says so, when the file is outside the project", async () => {
    const store = storeWith({
      rule: { store: "file", file: "../elsewhere.md" },
      worktree: tempDir(),
    });
    const added = await store.add(change);
    expect(added.followUp.place).toBe("store");
    expect(added.note).toMatch(/outside the project/u);
  });
});

describe("the github store", () => {
  it("creates a labelled issue with the user's gh and keeps its URL", async () => {
    const { gh, calls } = fakeGh(signedIn);
    const store = storeWith({ rule: { store: "github" }, gh });
    const { followUp, note } = await store.add(change);
    expect(followUp).toMatchObject({
      place: "github",
      url: "https://github.com/acme/se-backend/issues/12",
    });
    expect(note).toBeUndefined();
    expect(calls.map(c => c.args.slice(0, 2))).toEqual([
      ["auth", "status"],
      ["label", "create"],
      ["issue", "create"],
    ]);
    expect(calls.at(-1)?.args).toEqual(
      expect.arrayContaining([
        "--label",
        "ork-follow-up",
        "--title",
        change.title,
      ]),
    );
    expect(calls.every(c => c.cwd === PROJECT)).toBe(true);
  });

  it("uses the rule's label", async () => {
    const { gh, calls } = fakeGh(signedIn);
    await storeWith({ rule: { store: "github", label: "later" }, gh }).add(
      change,
    );
    expect(calls.at(-1)?.args).toEqual(
      expect.arrayContaining(["--label", "later"]),
    );
  });

  it("falls back to Ork's store, saying so, when gh isn't signed in", async () => {
    const { gh, calls } = fakeGh(() => failed("You are not logged in"));
    const added = await storeWith({ rule: { store: "github" }, gh }).add(
      change,
    );
    expect(added.followUp.place).toBe("store");
    expect(added.note).toMatch(/gh isn't signed in/u);
    expect(calls.length).toBe(1);
  });

  it("falls back to Ork's store when gh can't create the issue", async () => {
    const { gh } = fakeGh(refusesIssues);
    const added = await storeWith({ rule: { store: "github" }, gh }).add(
      change,
    );
    expect(added.followUp.place).toBe("store");
    expect(added.note).toMatch(/HTTP 403/u);
  });
});
