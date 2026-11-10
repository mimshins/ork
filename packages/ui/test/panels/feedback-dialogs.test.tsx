/**
 * @file Tests for the Feedback panel's dialogs on a fake server: a lesson names
 *   its file and how full it is, follows its words in its CLI twin, and keeps a
 *   refusal; Propose fix names the project, takes a driver, starts the run and
 *   goes to the Monitor; publishing reads a preview, posts only on Post with
 *   the digest it showed, shows a changed text again, and says nothing was sent
 *   on Cancel.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { item, LOOP, PREVIEW } from "./feedback-fixtures.ts";
import {
  actions,
  announced,
  asked,
  choose,
  openFeedback,
  pick,
  settle,
} from "./feedback-harness.tsx";

/** Finds the paragraph whose whole text is `words`, code and all. */
const paragraphSaying =
  (words: string) =>
  (_: string, element: Element | null): boolean =>
    element?.tagName === "P" && element.textContent === words;

const LOOP_TITLE = "The loop reviews -> lead ran out of its 2 rounds";
const ORK_TITLE = "`feedback` tool error: invalid evidence";

/** The dialog open now; toasts are dialogs too, so it's found by name. */
const MODAL = /^(?:Add a lesson|Publish )/u;
const dialog = () => within(screen.getByRole("dialog", { name: MODAL }));
const modalGone = async () => {
  await vi.waitFor(() => {
    expect(screen.queryByRole("dialog", { name: MODAL })).toBeNull();
  });
};

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("adding a lesson", () => {
  it("names the file and how full it is, then adds the words written", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Add lesson…" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Add a lesson for review-loop",
      }),
    ).toBeDefined();
    expect(dialog().getByText(".ork/lessons/review-loop.md")).toBeDefined();
    expect(dialog().getByText("about 412 of 1,500 tokens")).toBeDefined();
    const lesson = dialog().getByRole("textbox", { name: /^Lesson/u });
    expect(lesson).toHaveProperty("value", LOOP_TITLE);
    expect(
      dialog().getByText("ork feedback accept 9fae0c1d2e3f --lesson"),
    ).toBeDefined();
    await userEvent.clear(lesson);
    await userEvent.type(lesson, "Give the loop 3 rounds");
    expect(
      dialog().getByText(
        "ork feedback accept 9fae0c1d2e3f --lesson -m 'Give the loop 3 rounds'",
      ),
    ).toBeDefined();
    await userEvent.click(dialog().getByRole("button", { name: "Add lesson" }));
    expect(await screen.findByText("Lesson added")).toBeDefined();
    expect(asked(opened, "accept")).toEqual([
      {
        route: "accept",
        id: LOOP,
        body: { lesson: true, text: "Give the loop 3 rounds" },
      },
    ]);
    await modalGone();
  });

  it("asks which workflow when there's a choice, and says why it waits", async () => {
    await openFeedback({
      items: [item(LOOP, { workflows: ["review-loop", "build"] })],
    });
    await choose("Title of 9fae0c1d2e3f");
    await userEvent.click(
      actions().getByRole("button", { name: "Add lesson…" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Add a lesson" }),
    ).toBeDefined();
    expect(dialog().getByText("Choose a workflow.")).toBeDefined();
    const add = dialog().getByRole("button", { name: "Add lesson" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    await pick("Workflow (required)", "build");
    expect(
      screen.getByRole("dialog", { name: "Add a lesson for build" }),
    ).toBeDefined();
    expect(dialog().getByText(/--workflow build$/u)).toBeDefined();
  });

  it("keeps a refusal in the dialog", async () => {
    await openFeedback({
      refuse: {
        accept: {
          status: 409,
          error: "It would be over the 1,500 a session loads.",
        },
      },
    });
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Add lesson…" }),
    );
    await screen.findByRole("dialog", { name: MODAL });
    await userEvent.click(dialog().getByRole("button", { name: "Add lesson" }));
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "Could not add the lesson: It would be over the 1,500 a session loads.",
    );
    expect(screen.getByRole("dialog", { name: MODAL })).toBeDefined();
  });
});

describe("proposing a fix", () => {
  it("names the project, starts the run and goes to the Monitor", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Propose fix…" }),
    );
    const confirm = await screen.findByRole("alertdialog", {
      name: "Propose a fix for 9fae0c1d2e3f?",
    });
    expect(confirm.textContent).toContain("in /code/app. It's a paid run");
    expect(
      within(confirm).getByText("ork feedback apply 9fae0c1d2e3f"),
    ).toBeDefined();
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Start run" }),
    );
    expect(await screen.findByText("Run fix11111 started")).toBeDefined();
    expect(asked(opened, "apply")).toEqual([
      { route: "apply", id: LOOP, body: {} },
    ]);
    expect(opened.goTo).toHaveBeenCalledWith("monitor");
    expect(opened.state.selection.getValue().run).toBe("fix11111");
    expect(opened.state.takeArrival("fix11111")).toBe(true);
  });

  it("takes a driver, in its command and its request", async () => {
    const opened = await openFeedback();
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Propose fix…" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("combobox", { name: "Driver" }).textContent,
    ).toContain("The workflow's, else the one ready");
    await pick("Driver", "claude-code");
    expect(
      within(confirm).getByText(
        "ork feedback apply 9fae0c1d2e3f --driver claude-code",
      ),
    ).toBeDefined();
    expect(await violations(confirm)).toEqual([]);
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Start run" }),
    );
    await screen.findByText("Run fix11111 started");
    expect(asked(opened, "apply")).toEqual([
      { route: "apply", id: LOOP, body: { driver: "claude-code" } },
    ]);
  });

  it("keeps a refusal in the dialog, and starts nothing", async () => {
    const opened = await openFeedback({
      refuse: { apply: { status: 409, error: "Its project is gone." } },
    });
    await choose(LOOP_TITLE);
    await userEvent.click(
      actions().getByRole("button", { name: "Propose fix…" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Start run" }),
    );
    expect((await within(confirm).findByRole("alert")).textContent).toBe(
      "Could not start the run: Its project is gone.",
    );
    expect(opened.goTo).not.toHaveBeenCalled();
  });
});

const openPublish = async (over: Parameters<typeof openFeedback>[0] = {}) => {
  const opened = await openFeedback(over);
  await choose(ORK_TITLE);
  await userEvent.click(actions().getByRole("button", { name: "Publish…" }));
  await screen.findByRole("dialog", {
    name: "Publish 0893f0aa11bb to Ork's Discussions",
  });
  await vi.waitFor(() => {
    expect(
      screen.getByRole("region", { name: "Text to post" }).textContent,
    ).toBe(PREVIEW.post.body);
  });
  return opened;
};

describe("publishing", () => {
  it("shows exactly what would be sent, and posts nothing until Post", async () => {
    const opened = await openPublish();
    const text = screen.getByRole("region", { name: "Text to post" });
    expect(text.textContent).toBe(PREVIEW.post.body);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(text);
    });
    expect(
      dialog().getByText(
        paragraphSaying(
          "A new thread in the Agent feedback category of mimshins/ork.",
        ),
      ),
    ).toBeDefined();
    expect(dialog().getByText(PREVIEW.post.title)).toBeDefined();
    await userEvent.keyboard("{Enter}");
    await settle();
    expect(asked(opened, "publish")).toEqual([]);
    expect(await violations(document.body)).toEqual([]);
  });

  it("posts the text it showed, by its digest, and says where it went", async () => {
    const opened = await openPublish();
    await userEvent.click(
      dialog().getByRole("button", { name: "Post thread" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Posted" }),
    ).toBeDefined();
    expect(asked(opened, "publish")).toEqual([
      {
        route: "publish",
        id: "0893f0aa11bb",
        body: { hideNames: false, digest: PREVIEW.digest },
      },
    ]);
    expect(
      dialog().getByRole("link", {
        // jsdom drops the space before words only a screen reader hears.
        name: /discussions\/41\s*\(opens in a new tab\)$/u,
      }),
    ).toBeDefined();
    expect(dialog().getByText("0893f0aa11bb is published.")).toBeDefined();
  });

  it("reads again with names hidden, and its CLI twin says so", async () => {
    const opened = await openPublish();
    await userEvent.click(
      dialog().getByRole("checkbox", {
        name: "Hide repository and workflow names",
      }),
    );
    expect(
      await dialog().findByText(
        "ork feedback publish 0893f0aa11bb --hide-names",
      ),
    ).toBeDefined();
    await vi.waitFor(() => {
      expect(asked(opened, "publish/preview").map(call => call.body)).toEqual([
        { hideNames: false },
        { hideNames: true },
      ]);
    });
  });

  it("keeps the text in view, dimmed, when reading it again fails", async () => {
    const opened = await openPublish();
    opened.server.refuse = {
      "publish/preview": { status: 400, error: "gh failed: not logged in" },
    };
    await userEvent.click(
      dialog().getByRole("checkbox", {
        name: "Hide repository and workflow names",
      }),
    );
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "Could not read Ork's Discussions: gh failed: not logged in. Nothing was sent.",
    );
    const text = dialog().getByRole("region", { name: "Text to post" });
    expect([text.textContent, Object.hasOwn(text.dataset, "stale")]).toEqual([
      PREVIEW.post.body,
      true,
    ]);
    expect(dialog().getByText(PREVIEW.post.title)).toBeDefined();
    expect(
      dialog()
        .getByRole("button", { name: "Post thread" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("shows a text that changed since it was read, to be read again", async () => {
    const changed = { ...PREVIEW, digest: "digest-2" };
    const opened = await openPublish({
      previews: [PREVIEW, changed],
      refuse: {
        publish: { status: 409, error: "What would be sent changed." },
      },
    });
    await userEvent.click(
      dialog().getByRole("button", { name: "Post thread" }),
    );
    expect(
      await dialog().findByText(
        "The text to post changed since you read it. Read it again before posting.",
      ),
    ).toBeDefined();
    expect(asked(opened, "publish")).toHaveLength(1);
    expect(
      dialog()
        .getByRole("button", { name: "Post thread" })
        .getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("says nothing was sent when cancelled", async () => {
    const opened = await openPublish();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    await modalGone();
    expect(announced(opened)).toBe("Nothing was sent.");
    expect(asked(opened, "publish")).toEqual([]);
  });

  it("says a failed read, and that nothing was sent", async () => {
    await openFeedback({
      refuse: {
        "publish/preview": { status: 400, error: "gh failed: not logged in" },
      },
    });
    await choose(ORK_TITLE);
    await userEvent.click(actions().getByRole("button", { name: "Publish…" }));
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "Could not read Ork's Discussions: gh failed: not logged in. Nothing was sent.",
    );
    expect(
      dialog()
        .getByRole("button", { name: "Post thread" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
