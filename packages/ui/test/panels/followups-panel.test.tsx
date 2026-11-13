/**
 * @file Tests for the Follow-ups panel: the list grouped by due and for, a
 *   row's name, the shared filter bar (a value asks the server, a refusal shows
 *   inline, Clear filter resets), an item's draft and steps to copy, each
 *   action through the server's routes (nothing optimistic, a refusal a toast),
 *   the focus after one, the Post to GitHub dialog that posts only the digest
 *   it showed, the checker note, the states, and the due count on the tab.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FollowUpsCount } from "../../src/panels/followups-count.tsx";
import { stubWindow } from "../dom.ts";
import {
  announced,
  asked,
  choose,
  firstOf,
  focusedHeading,
  focusedRow,
  openFollowUps,
  pick,
  PR,
  rowOf,
} from "./followups-harness.tsx";
import { renderPanel } from "./harness.tsx";

const MESSAGE = "Message Acme about the webhook change";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the list", () => {
  it("groups by due, then by for, with a heading each", async () => {
    await openFollowUps();
    const headings = screen
      .getAllByRole("heading", { level: 4 })
      .map(h => h.textContent);
    expect(headings).toEqual([
      "Now · 1",
      "After merge · 2",
      "Overdue · 2020-01-01 · 1",
    ]);
    expect(screen.getByText("person:acme-ops")).toBeDefined();
    expect(screen.queryByText("Old check")).toBeNull();
  });

  it("names a row by everything it shows, in order", async () => {
    await openFollowUps();
    expect(rowOf(MESSAGE).getAttribute("name")).toBeNull();
    const text = rowOf(MESSAGE).textContent;
    expect(text).toContain("due");
    expect(text).toContain("4f2a1c");
    expect(text).toContain("message");
    expect(text).toContain("after merge");
    expect(text).toContain("PR merged");
    expect(text).toContain("#142");
  });

  it("has one tab stop, and the arrow keys move through every group", async () => {
    await openFollowUps();
    const rows = screen
      .getAllByRole("button")
      .filter(b => b.dataset["followUp"] !== undefined);
    expect(rows.filter(b => b.tabIndex === 0)).toHaveLength(1);
    rows[0]?.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(rows[2]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(rows.at(-1));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("says the summary, and shows the shared bar with open as the default", async () => {
    await openFollowUps();
    expect(screen.getByText("2 due, 2 waiting")).toBeDefined();
    const bar = screen.getByRole("search", { name: "Filter follow-ups" });
    expect(
      within(bar).getByRole("combobox", { name: "Status" }).textContent,
    ).toBe("Default (open)");
    expect(
      within(bar).queryByRole("button", { name: "Clear filter" }),
    ).toBeNull();
  });

  it("asks the server for a filter, says the count, and shows the command", async () => {
    const opened = await openFollowUps();
    await pick("Status", "done");
    await vi.waitFor(() => {
      expect(asked(opened, "list").at(-1)?.query).toBe("status=done");
    });
    expect(await screen.findByText("Old check")).toBeDefined();
    expect(screen.queryByText("Run the migration")).toBeNull();
    expect(screen.getByText("1 follow-up matches.")).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Copy command (ork follow-ups list --status done)",
      }),
    ).toBeDefined();
    await pick("Kind", "message");
    expect(
      await screen.findByText("No follow-ups match the filter."),
    ).toBeDefined();
    expect(asked(opened, "list").at(-1)?.query).toBe(
      "status=done&kind=message",
    );
  });

  it("says the server's words for a refused value, and keeps the last list", async () => {
    const opened = await openFollowUps();
    const field = screen.getByRole("combobox", { name: "For" });
    await userEvent.type(field, "bad{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "--for takes agent, me or a target, not bad.",
    );
    expect(asked(opened, "list").at(-1)?.query).toBe("for=bad");
    expect(screen.getByText("Run the migration")).toBeDefined();
    expect(screen.getByText("4 follow-ups match.")).toBeDefined();
  });

  it("clears the filter and reads the open ones again", async () => {
    const opened = await openFollowUps();
    await pick("Status", "done");
    await screen.findByText("1 follow-up matches.");
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await vi.waitFor(() => {
      expect(asked(opened, "list").at(-1)?.query).toBe("");
    });
    expect(await screen.findByText("Run the migration")).toBeDefined();
    expect(screen.getByText("Filter cleared.")).toBeDefined();
  });

  it("does not say a follow-up came due when the filter changes", async () => {
    const opened = await openFollowUps();
    await pick("Status", "due");
    await screen.findByText("2 follow-ups match.");
    expect(announced(opened)).toBe("");
  });
});

describe("an item", () => {
  it("shows its draft with Copy, and says Ork never sends it", async () => {
    await openFollowUps();
    await choose(MESSAGE);
    expect(
      screen.getByRole("heading", { level: 3, name: MESSAGE }),
    ).toBeDefined();
    expect(screen.getByText("Draft message")).toBeDefined();
    expect(screen.getByText("The webhook moved to v2.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeDefined();
    expect(
      screen.getByText(
        "Ork never sends this. Copy it, send it yourself, then mark it sent.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy ork follow-ups show 4f2a1c" }),
    ).toBeDefined();
  });

  it("shows steps with a copy button on each command, and never runs one", async () => {
    await openFollowUps();
    await choose("Run the migration");
    expect(
      screen.getByText(
        "Ork never runs these. Run each yourself, then mark this done.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Back up first.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy ./migrate.sh --prod" }),
    ).toBeDefined();
  });

  it("offers an agent's change to a run, with the command", async () => {
    await openFollowUps();
    await choose("Add retries to the billing client");
    expect(
      screen.getByRole("button", {
        name: "Copy ork run start --follow-ups 6b7c8d",
      }),
    ).toBeDefined();
    expect(
      screen.getByText("Done when a run that takes it publishes."),
    ).toBeDefined();
  });

  it("says the PR is a link, and where it is kept", async () => {
    await openFollowUps();
    await choose(MESSAGE);
    const link = screen.getByRole("link", { name: new RegExp(PR, "u") });
    expect(link.getAttribute("href")).toBe(PR);
    expect(screen.getByText("Ork's store")).toBeDefined();
  });
});

describe("the actions", () => {
  it("marks a message sent through the server, then says so and moves on", async () => {
    const opened = await openFollowUps();
    await choose(MESSAGE);
    await userEvent.click(screen.getByRole("button", { name: "Mark sent" }));
    await vi.waitFor(() => {
      expect(asked(opened, "change")).toEqual([
        {
          route: "change",
          path: "/api/projects/api/follow-ups/4f2a1c11",
          body: { action: "done" },
        },
      ]);
      expect(announced(opened)).toBe(`Marked sent: ${MESSAGE}.`);
    });
    // Under Open it leaves the list: the choice goes to the next row.
    await vi.waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^Message Acme/u }),
      ).toBeNull();
    });
    expect(focusedRow()).toBeDefined();
  });

  it("keeps the item and its heading when it stays in the list", async () => {
    const opened = await openFollowUps();
    await choose("Add retries to the billing client");
    await userEvent.click(screen.getByRole("button", { name: "Mark due" }));
    await vi.waitFor(() => {
      expect(announced(opened)).toBe(
        "Marked due: Add retries to the billing client.",
      );
    });
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Add retries to the billing client",
      }),
    ).toBeDefined();
    expect(focusedHeading()).toBe(true);
  });

  it("drops, and reopens from Dropped", async () => {
    const opened = await openFollowUps();
    await choose("Run the migration");
    await userEvent.click(screen.getByRole("button", { name: "Drop" }));
    await vi.waitFor(() => {
      expect(announced(opened)).toBe("Dropped: Run the migration.");
    });
    await pick("Status", "dropped");
    await choose("Run the migration");
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await vi.waitFor(() => {
      expect(announced(opened)).toContain("Reopened: Run the migration, due.");
    });
  });

  it("shows a refusal as a toast and changes nothing", async () => {
    const opened = await openFollowUps({ refuseChange: "It is locked." });
    await choose("Run the migration");
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("Couldn't mark done")).toBeDefined();
    expect(screen.getByText("It is locked.")).toBeDefined();
    expect(opened.server.rows[1]?.status).toBe("due");
    expect(
      screen.getByRole("heading", { level: 3, name: "Run the migration" }),
    ).toBeDefined();
  });

  it("shows each action with its CLI twin in the tooltip", async () => {
    await openFollowUps();
    await choose("Run the migration");
    const drop = screen.getByRole("button", { name: "Drop" });
    await userEvent.hover(drop);
    expect(await screen.findByText("ork follow-ups drop 5a6b7c")).toBeDefined();
  });
});

const openPost = async (server = {}) => {
  const opened = await openFollowUps(server);
  await choose(MESSAGE);
  await userEvent.click(
    screen.getByRole("button", { name: "Post to GitHub…" }),
  );
  return opened;
};

describe("Post to GitHub", () => {
  it("shows exactly what it will post, and posts nothing on Cancel", async () => {
    const opened = await openPost();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Post to GitHub?")).toBeDefined();
    expect(dialog.textContent).toContain(
      "This posts the comment below to acme/api#142 as you, through your gh. Ork sends nothing else.",
    );
    expect(within(dialog).getByText("The webhook moved to v2.")).toBeDefined();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(asked(opened, "post")).toEqual([]);
    expect(announced(opened)).toBe("Cancelled. Nothing was posted.");
  });

  it("sends the digest it showed, then marks sent with a toast", async () => {
    const opened = await openPost();
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await vi.waitFor(() => {
      expect(asked(opened, "post")).toEqual([
        {
          route: "post",
          path: "/api/projects/api/follow-ups/4f2a1c11/post",
          body: { confirm: true, digest: "digest:The webhook moved to v2." },
        },
      ]);
    });
    expect(await screen.findByText("Posted to acme/api#142")).toBeDefined();
    expect(announced(opened)).toBe("Posted to acme/api#142. Marked sent.");
  });

  it("keeps a failure in the dialog, and the item as it was", async () => {
    const opened = await openPost({ refusePost: "gh: not logged in" });
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(
      await screen.findByText(
        /Not posted: gh: not logged in\. Copy the text and post it yourself/u,
      ),
    ).toBeDefined();
    expect(opened.server.rows[0]?.status).toBe("due");
  });

  it("says a changed draft needs reading again", async () => {
    await openPost({
      refusePost:
        "The draft is no longer the one you confirmed; open it again.",
    });
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(
      await screen.findByText(
        "The draft changed since you opened this. Read it again.",
      ),
    ).toBeDefined();
  });

  it("stays focusable but disabled, naming why, for a draft Ork can't post", async () => {
    const why = "its `to` isn't a GitHub issue or pull request URL";
    const opened = await openFollowUps({ badDraft: why });
    await choose(MESSAGE);
    const post = screen.getByRole("button", {
      name: `Post to GitHub…: ${why}`,
    });
    expect(post.getAttribute("aria-disabled")).toBe("true");
    post.focus();
    expect(document.activeElement).toBe(post);
    await userEvent.click(post);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(asked(opened, "post")).toEqual([]);
    expect(
      await screen.findByText(
        /Can't post: .*Copy the message and post it yourself\./u,
      ),
    ).toBeDefined();
  });

  it("gives only the reason, without the copy advice, when the item is closed", async () => {
    await openFollowUps({ badStatus: "closed by a teammate" });
    await choose(MESSAGE);
    const post = screen.getByRole("button", {
      name: "Post to GitHub…: closed by a teammate",
    });
    post.focus();
    expect(
      await screen.findByText("Can't post: closed by a teammate."),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain(
      "Copy the message and post it yourself.",
    );
  });

  it("has no button for a channel Ork can't send to", async () => {
    await openFollowUps();
    await choose("Tell Dana the API moved");
    expect(
      screen.queryByRole("button", { name: "Post to GitHub…" }),
    ).toBeNull();
    expect(document.body.textContent).toContain(
      "Ork can't send to slack. Copy the message and send it yourself.",
    );
  });
});

describe("the states", () => {
  it("says there are none, with the way to add one", async () => {
    await openFollowUps({ rows: [] });
    expect(screen.getByText("No open follow-ups.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Copy ork follow-ups add" }),
    ).toBeDefined();
    expect(screen.getByText("Nothing open")).toBeDefined();
  });

  it("asks to choose one in the wide layout", async () => {
    await openFollowUps();
    expect(screen.getByText("Choose a follow-up to read it.")).toBeDefined();
  });

  it("says when PRs can't be checked", async () => {
    await openFollowUps({ checkerErrors: ["gh failed: not logged in"] });
    expect(document.body.textContent).toContain(
      "Can't check PRs: gh isn't signed in. After-merge follow-ups stay waiting. Run this in a terminal:",
    );
  });

  it("says a read failed, keeps the page, and tries again", async () => {
    const opened = await openFollowUps({ failList: "The server broke." });
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(
      screen.getByText(/Couldn't read follow-ups: The server broke\./u),
    ).toBeDefined();
    opened.server.failList = undefined;
    await userEvent.click(
      firstOf(screen.getAllByRole("button", { name: "Try again" })),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("reads again on Reload", async () => {
    const opened = await openFollowUps();
    const before = asked(opened, "list").length;
    await userEvent.click(
      screen.getByRole("button", { name: "Reload follow-ups" }),
    );
    await vi.waitFor(() => {
      expect(asked(opened, "list").length).toBeGreaterThan(before);
    });
  });
});

const countWith = async (count: number) => {
  const opened = await openFollowUps();
  renderPanel(opened.state, <FollowUpsCount />);
  await opened.state.followUpsDue.setValue({ count, items: [] });
  return opened;
};

describe("the tab's due count", () => {
  it("draws nothing when none is due", async () => {
    const opened = await openFollowUps();
    const { container } = renderPanel(opened.state, <FollowUpsCount />);
    expect(container.textContent).toBe("");
  });

  it("draws the number, and spells it out for a screen reader", async () => {
    await countWith(3);
    expect(await screen.findByText(", 3 due")).toBeDefined();
  });

  it("caps at 99+", async () => {
    await countWith(120);
    expect(await screen.findByText("99+")).toBeDefined();
    expect(screen.getByText(", 120 due")).toBeDefined();
  });
});
