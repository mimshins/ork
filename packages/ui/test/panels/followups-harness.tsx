/**
 * @file The Follow-ups panel's tests' data, fake server and harness: follow-ups
 *   as `GET /api/projects/:id/follow-ups` sends them, a detail with what each
 *   allows (as the server's rule says), answers to every follow-up route that
 *   record what was asked, and the panel in a workspace whose announcements a
 *   test can read.
 */

import type {
  FollowUp,
  FollowUpDetail,
  FollowUpsList,
} from "@krapht/ork-server/client";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { FollowUpsPanel } from "../../src/panels/followups-panel.tsx";
import { createWorkspace } from "../../src/workspace/workspace.ts";
import { openPanelState, project, renderPanel } from "./harness.tsx";

const AT = "2026-11-10T09:00:00.000Z";

export const followUp = (
  id: string,
  over: Partial<FollowUp> = {},
): FollowUp => ({
  id,
  project: "/repos/api",
  title: `Follow-up ${id}`,
  body: "",
  for: "me",
  kind: "task",
  due: "now",
  where: [],
  from: {},
  status: "due",
  place: "store",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

export const PR = "https://github.com/acme/api/pull/142";

export const MESSAGE = followUp("4f2a1c11", {
  title: "Message Acme about the webhook change",
  for: "person:acme-ops",
  kind: "message",
  due: "after-merge",
  ref: PR,
  status: "due",
  note: `${PR} merged`,
  draft: { to: PR, channel: "github", text: "The webhook moved to v2." },
});

export const MIGRATION = followUp("5a6b7c22", {
  title: "Run the migration",
  steps: [
    { text: "Back up first." },
    { text: "Migrate.", command: "./migrate.sh --prod" },
  ],
});

export const RETRIES = followUp("6b7c8d33", {
  title: "Add retries to the billing client",
  for: "agent",
  kind: "change",
  due: "after-merge",
  status: "waiting",
  body: "The client gives up on the first 503.",
});

export const DANA = followUp("7c8d9e44", {
  title: "Tell Dana the API moved",
  for: "person:dana",
  kind: "message",
  due: "2020-01-01",
  status: "waiting",
  draft: { to: "Dana", channel: "slack", text: "Hi Dana." },
});

export const OLD = followUp("8d9eaf55", {
  title: "Old check",
  status: "done",
  kind: "check",
});

/** One of each kind of follow-up, as a change for a partner leaves them. */
export const FOLLOW_UPS: FollowUp[] = [MESSAGE, MIGRATION, RETRIES, DANA, OLD];

export type FollowUpsServer = {
  rows: FollowUp[];
  asked: { route: string; path: string; query?: string; body?: unknown }[];
  /** Why the list can't be read, if it can't. */
  failList?: string | undefined;
  /** Why `gh` can't check the PRs, if it can't. */
  checkerErrors?: string[];
  /** The server's refusal of a change, or of a post, if it refuses. */
  refuseChange?: string;
  refusePost?: string;
  /** Why the server says a github draft can't be posted, if it says so. */
  badDraft?: string;
  /** Why the server says the follow-up's status stops a post, if it says so. */
  badStatus?: string;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const CHECK_OK = { ok: true } as const;

const closed = (why: string, kind: "status" | "draft" = "status") =>
  ({ ok: false, kind, why, error: why }) as const;

const postOf = (
  f: FollowUp,
  open: boolean,
  badDraft?: string,
  badStatus?: string,
) => {
  if (f.draft?.channel !== "github" || !open) {
    return closed("not drafted for the github channel", "draft");
  }
  if (badStatus !== undefined) return closed(badStatus);
  return badDraft === undefined ? CHECK_OK : closed(badDraft, "draft");
};

const detailOf = (
  f: FollowUp,
  badDraft?: string,
  badStatus?: string,
): FollowUpDetail => {
  const open = f.status === "due" || f.status === "waiting";
  return {
    followUp: f,
    actions: {
      done: open ? CHECK_OK : closed(`it is ${f.status}`),
      drop: open ? CHECK_OK : closed(`it is ${f.status}`),
      reopen: open ? closed(`it is ${f.status}`) : CHECK_OK,
      due: f.status === "waiting" ? CHECK_OK : closed(`it is ${f.status}`),
      post: postOf(f, open, badDraft, badStatus),
    },
    ...(f.status === "due" && f.note?.endsWith(" merged") === true
      ? { cause: "merged" as const }
      : {}),
    keptIn: { place: f.place, rule: "store" },
    ...(f.draft === undefined ? {} : { draftDigest: `digest:${f.draft.text}` }),
    copy: {
      text: f.draft?.text ?? "",
      commands: (f.steps ?? []).flatMap(s =>
        s.command === undefined ? [] : [s.command],
      ),
    },
  };
};

const ACTIONS = ["done", "drop", "reopen", "due"] as const;

const STATUS_AFTER = {
  done: "done",
  drop: "dropped",
  reopen: "waiting",
  due: "due",
} as const;

const STATUSES = ["due", "waiting", "done", "dropped", "all"];

/** What the list route answers for a query: open by default, as the server does. */
const listed = (
  rows: readonly FollowUp[],
  query: URLSearchParams,
): FollowUp[] | string => {
  const status = query.get("status") ?? "open";
  if (status !== "open" && !STATUSES.includes(status)) {
    return `--status takes one of ${STATUSES.join(", ")}, not \`${status}\`.`;
  }
  const target = query.get("for");
  if (target?.startsWith("bad") === true) {
    return `--for takes agent, me or a target, not ${target}.`;
  }
  return rows.filter(
    f =>
      (status === "all" ||
        (status === "open"
          ? f.status === "due" || f.status === "waiting"
          : f.status === status)) &&
      (query.get("kind") ?? f.kind) === f.kind &&
      (query.get("for") ?? f.for) === f.for,
  );
};

/** The follow-ups routes of a fake server, in the harness's `builder` hook. */
export const followUpsRoute =
  (fake: FollowUpsServer) =>
  (
    path: string,
    body: unknown,
    query = new URLSearchParams(),
  ): Response | undefined => {
    const match =
      /^\/api\/projects\/api\/follow-ups(?:\/([^/]+)(\/post)?)?$/u.exec(path);
    if (match === null) return undefined;
    const [, id, post] = match;
    const one = fake.rows.find(f => f.id === id);
    if (id === undefined) {
      fake.asked.push({ route: "list", path, query: query.toString() });
      if (fake.failList !== undefined) {
        return json({ error: fake.failList }, 500);
      }
      const matched = listed(fake.rows, query);
      if (typeof matched === "string") return json({ error: matched }, 400);
      const list: FollowUpsList = {
        project: "/repos/api",
        followUps: matched,
        due: fake.rows.filter(f => f.status === "due").length,
        checker: {
          available: fake.checkerErrors === undefined,
          errors: fake.checkerErrors ?? [],
        },
      };
      return json(list);
    }
    if (one === undefined) return json({ error: "No follow-up." }, 404);
    if (post !== undefined) {
      fake.asked.push({ route: "post", path, body });
      if (fake.refusePost !== undefined) {
        return json({ error: fake.refusePost }, 409);
      }
      fake.rows = fake.rows.map(f =>
        f.id === one.id ? { ...f, status: "done" } : f,
      );
      return json({
        url: `${PR}#c1`,
        followUp: detailOf(one, fake.badDraft, fake.badStatus),
      });
    }
    if (body === undefined)
      return json(detailOf(one, fake.badDraft, fake.badStatus));
    fake.asked.push({ route: "change", path, body });
    if (fake.refuseChange !== undefined) {
      return json({ error: fake.refuseChange }, 409);
    }
    const action = ACTIONS.find(
      name => JSON.stringify(body) === JSON.stringify({ action: name }),
    );
    if (action === undefined) return json({ error: "Bad action." }, 400);
    const changed = { ...one, status: STATUS_AFTER[action] };
    fake.rows = fake.rows.map(f => (f.id === one.id ? changed : f));
    return json(detailOf(changed, fake.badDraft, fake.badStatus));
  };

export const openFollowUps = async (server: Partial<FollowUpsServer> = {}) => {
  const fake: FollowUpsServer = { rows: FOLLOW_UPS, asked: [], ...server };
  const opened = openPanelState({
    projects: [project("api")],
    builder: followUpsRoute(fake),
  });
  const workspace = createWorkspace({ storage: localStorage, wide: true });
  vi.spyOn(workspace, "goTo").mockImplementation(() => {});
  const view = renderPanel(opened.state, <FollowUpsPanel />, workspace);
  await vi.waitFor(() => {
    expect(screen.queryByText("Reading follow-ups…")).toBeNull();
  });
  return { ...opened, server: fake, workspace, view };
};

export type OpenedFollowUps = Awaited<ReturnType<typeof openFollowUps>>;

const escaped = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** A row, by the start of its name: the follow-up's title. */
export const rowOf = (title: string): HTMLElement =>
  screen.getByRole("button", { name: new RegExp(`^${escaped(title)},`, "u") });

/** Chooses a follow-up and waits for its detail. */
export const choose = async (title: string): Promise<void> => {
  await userEvent.click(rowOf(title));
  await screen.findByRole("group", { name: /^Actions on/u });
};

export const announced = (opened: OpenedFollowUps): string =>
  opened.workspace.announcement.getValue();

/** The named route's calls. */
export const asked = (opened: OpenedFollowUps, route: string) =>
  opened.server.asked.filter(call => call.route === route);

/** Picks an option of a select. */
export const pick = async (label: string, option: string): Promise<void> => {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
};

/** Whether the focus is on the chosen follow-up's heading. */
export const focusedHeading = (): boolean =>
  document.activeElement instanceof HTMLElement &&
  document.activeElement.dataset["followupsHeading"] !== undefined;

/** The id of the row that has the focus, if one does. */
export const focusedRow = (): string | undefined =>
  document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset["followUp"]
    : undefined;

/** The first of `items`, or a failure saying there was none. */
export const firstOf = <T,>(items: readonly T[]): T => {
  const [first] = items;
  if (first === undefined) throw new Error("none");
  return first;
};
