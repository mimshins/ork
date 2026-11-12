/**
 * @file Tests for what a person does to a follow-up: finding one by an id
 *   prefix, and the done, drop, reopen and due actions with the statuses each
 *   starts from, and when a github draft can be posted (its `to` an issue or
 *   pull request URL).
 */

import { describe, expect, it } from "vitest";

import {
  changeFollowUp,
  dueCause,
  findFollowUp,
  followUpActions,
  type FollowUp,
  type FollowUpAction,
  isGithubIssueUrl,
  openStore,
} from "../src/index.ts";

const PROJECT = "/work/app";
const AT = "2026-11-12T10:00:00.000Z";

const made = (id: string, patch: Partial<FollowUp> = {}): FollowUp => ({
  id,
  project: PROJECT,
  title: `Follow-up ${id}`,
  body: "",
  for: "me",
  kind: "task",
  due: "after-merge",
  where: [],
  from: {},
  status: "waiting",
  place: "store",
  createdAt: AT,
  updatedAt: AT,
  ...patch,
});

/** The id a lookup found, or why it found none. */
const idOf = (found: ReturnType<typeof findFollowUp>): string =>
  found.ok ? found.followUp.id : found.error;

const noteOf = (result: ReturnType<typeof changeFollowUp>): string =>
  result.ok ? (result.followUp.note ?? "") : result.error;

const current = (rows: ReturnType<typeof openStore>): FollowUp => {
  const one = rows.followUp(PROJECT, "aa11");
  if (one === undefined) throw new Error("no follow-up aa11");
  return one;
};

const rowsWith = (...followUps: FollowUp[]) => {
  const rows = openStore(":memory:");
  for (const f of followUps) rows.putFollowUp(f);
  return rows;
};

/** The error, or the new status: a test body holds no conditional. */
const outcome = (
  status: FollowUp["status"],
  action: FollowUpAction,
  patch: Partial<FollowUp> = {},
): string => {
  const rows = rowsWith(made("aa11", { status, ...patch }));
  const first = rows.followUp(PROJECT, "aa11");
  const result = changeFollowUp(
    rows,
    first ?? made("missing"),
    action,
    () => AT,
  );
  return result.ok ? result.followUp.status : result.error;
};

describe("finding a follow-up", () => {
  it("takes an exact id or a unique prefix", () => {
    const rows = rowsWith(made("ab12cd"), made("ef34gh"));
    expect(idOf(findFollowUp(rows, PROJECT, "ab"))).toBe("ab12cd");
    expect(idOf(findFollowUp(rows, PROJECT, "ef34gh"))).toBe("ef34gh");
  });

  it("refuses an unknown id, an empty one and an ambiguous prefix", () => {
    const rows = rowsWith(made("ab12"), made("ab34"));
    expect(findFollowUp(rows, PROJECT, "zz")).toEqual({
      ok: false,
      error: "No follow-up `zz` in this project.",
    });
    expect(findFollowUp(rows, PROJECT, "").ok).toBe(false);
    expect(findFollowUp(rows, PROJECT, "ab")).toEqual({
      ok: false,
      error: "`ab` matches ab12, ab34; give more of the id.",
    });
  });

  it("looks only in the project it is asked about", () => {
    const rows = rowsWith(made("ab12", { project: "/work/other" }));
    expect(findFollowUp(rows, PROJECT, "ab").ok).toBe(false);
  });
});

describe("changing a follow-up", () => {
  it.each([
    ["waiting", "done", "done"],
    ["due", "done", "done"],
    ["waiting", "drop", "dropped"],
    ["due", "drop", "dropped"],
    ["waiting", "due", "due"],
    ["done", "reopen", "waiting"],
    ["dropped", "reopen", "waiting"],
  ] as const)("%s + %s -> %s", (status, action, expected) => {
    expect(outcome(status, action)).toBe(expected);
  });

  it("reopens one due now as due, not waiting", () => {
    expect(outcome("done", "reopen", { due: "now" })).toBe("due");
  });

  it.each([
    ["done", "done", "done"],
    ["dropped", "done", "done"],
    ["done", "drop", "dropped"],
    ["due", "due", "marked due"],
    ["waiting", "reopen", "reopened"],
  ] as const)("refuses %s + %s", (status, action, verb) => {
    expect(outcome(status, action)).toBe(
      `aa11 is ${status}, so it can't be ${verb}.`,
    );
  });

  it("keeps the change and says why in its note", () => {
    const rows = rowsWith(made("aa11", { note: "older note" }));
    const result = changeFollowUp(rows, current(rows), "done", () => AT);
    expect(noteOf(result)).toBe("done");
    expect(rows.followUp(PROJECT, "aa11")?.status).toBe("done");
  });
});

const due = (note?: string, status: FollowUp["status"] = "due") =>
  made("aa11", { status, ...(note === undefined ? {} : { note }) });

describe("what can be done, and why a follow-up is due", () => {
  it("allows each action from the right status, and says why not otherwise", () => {
    const open = followUpActions(made("aa11"));
    expect(open.done).toEqual({ ok: true });
    expect(open.due).toEqual({ ok: true });
    expect(open.reopen).toMatchObject({
      ok: false,
      kind: "status",
      why: "it is waiting",
    });
    const closed = followUpActions(made("aa11", { status: "done" }));
    expect(closed.reopen).toEqual({ ok: true });
    expect(closed.done).toEqual({
      ok: false,
      kind: "status",
      why: "it is done",
      error: "aa11 is done, so it can't be done.",
    });
  });

  it("allows a post only for an open github-channel message", () => {
    const draft = {
      to: "https://github.com/x/y/issues/1",
      channel: "github",
      text: "Hi",
    };
    const github = made("aa11", { kind: "message", draft });
    expect(followUpActions(github).post).toEqual({ ok: true });
    const slack = made("aa11", {
      kind: "message",
      draft: { ...draft, channel: "slack" },
    });
    expect(followUpActions(slack).post).toMatchObject({
      ok: false,
      kind: "draft",
      why: "not drafted for the github channel",
    });
    expect(followUpActions({ ...github, status: "done" }).post).toMatchObject({
      ok: false,
      kind: "status",
      why: "it is done",
    });
  });

  it.each(["142", "#142", "x/y#1", "https://github.com/x/y/pull/7/files"])(
    "refuses a post whose github `to` is %j",
    to => {
      const github = made("aa11", {
        kind: "message",
        draft: { to, channel: "github", text: "Hi" },
      });
      expect(followUpActions(github).post).toMatchObject({
        ok: false,
        kind: "draft",
        why: "its `to` isn't a GitHub issue or pull request URL",
      });
    },
  );

  it.each([
    ["https://github.com/x/y/issues/1", true],
    ["https://github.com/x/y/pull/7", true],
    ["https://github.com/x/y/pull/7#issuecomment-1", false],
    ["http://github.com/x/y/pull/7", false],
    ["https://gitlab.com/x/y/issues/1", false],
    ["#142", false],
  ] as const)("reads %j as an issue or PR URL: %s", (to, ok) => {
    expect(isGithubIssueUrl(to)).toBe(ok);
  });

  it.each([
    ["feature merged", "merged"],
    [
      "feature was closed without merging; decide whether it still applies",
      "closed-unmerged",
    ],
    ["due on 2026-11-12", "overdue"],
    ["marked due", "marked"],
    ["something else", undefined],
  ] as const)("reads %j as %s", (note, cause) => {
    expect(dueCause(due(note))).toBe(cause);
  });

  it("gives no cause to one that is not due or has no note", () => {
    expect(dueCause(due())).toBeUndefined();
    expect(dueCause(due("feature merged", "waiting"))).toBeUndefined();
  });
});
