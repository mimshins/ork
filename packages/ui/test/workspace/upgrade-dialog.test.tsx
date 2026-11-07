/**
 * @file Tests for the Upgrade dialog's steps against a fake `ork ui`: the plan
 *   with the server's exact command, or advice with nothing to run; running
 *   only after Upgrade, its output streamed into a region that has the focus,
 *   and no closing meanwhile; done with Restart, which waits for a new server
 *   on the upgraded version and reloads; and each other ending in its own
 *   words. The focus lands where the design says, and axe passes at each step.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violations } from "../axe.ts";
import { stubWindow } from "../dom.ts";
import { COMMAND, JOB, NOTES, PLAN, VERSION } from "./upgrade-fake.ts";
import {
  announced,
  connect,
  dialog,
  openUpgrade,
  type Opened,
  upgradeStream,
} from "./upgrade-harness.tsx";

beforeEach(() => {
  localStorage.clear();
  stubWindow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the dialog, as Upgrade… does, and waits for the plan. */
const openPlan = async (opened: Opened, latest = "0.4.0") => {
  const user = userEvent.setup();
  await connect(opened);
  act(() => {
    opened.state.version.openDialog("ask");
  });
  await screen.findByRole("dialog", { name: "Upgrade Ork" });
  await vi.waitFor(() => {
    expect(screen.getByRole("dialog").textContent).toContain(
      `Ork ${latest} is out (you have 0.3.0).`,
    );
  });
  return user;
};

/** Presses Upgrade and waits for the output's stream. */
const run = async (opened: Opened, user = userEvent.setup()) => {
  await user.click(dialog().getByRole("button", { name: "Upgrade to 0.4.0" }));
  await screen.findByRole("dialog", { name: "Upgrading Ork to 0.4.0" });
  const stream = upgradeStream(opened);
  act(() => {
    stream.connected();
  });
  return stream;
};

const end = (opened: Opened, state: "succeeded" | "failed", code: number) => {
  act(() => {
    upgradeStream(opened).send("end", { state, code, version: "0.4.0" });
  });
};

const focused = () => document.activeElement;

describe("the plan", () => {
  it("shows both versions, the installer's exact command and the runs still running", async () => {
    const opened = openUpgrade();
    await openPlan(opened);
    const plan = dialog();
    expect(
      plan.getByRole("region", { name: "Command to run" }).textContent,
    ).toBe(COMMAND.join(" "));
    expect(screen.getByRole("dialog").textContent).toContain(
      "Running now: 4f2a1c00, 7b1d0e00. Their next sessions would start from the new install; upgrading after they finish is safer.",
    );
    expect(screen.getByRole("dialog").textContent).toContain("pnpm (global)");
    // Nothing ran yet, and Upgrade isn't where the focus starts.
    expect(opened.server.asked).not.toContain("POST /api/upgrade");
    expect(focused()).toBe(plan.getByRole("button", { name: "Cancel" }));
    expect(await violations(document.body)).toEqual([]);
  });

  it("says nothing was changed when cancelled", async () => {
    const opened = openUpgrade();
    const user = await openPlan(opened);
    await user.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(announced(opened)).toContain("Nothing was changed.");
  });

  it("gives advice, with nothing to run, for a clone", async () => {
    const opened = openUpgrade({
      plans: [
        {
          kind: "advice",
          planId: "plan-2",
          current: "0.3.0",
          latest: "0.4.0",
          releaseNotes: NOTES,
          installer: { id: "source", label: "a clone of the repository" },
          text: "In /home/me/ork: git pull, then pnpm install and pnpm build.",
          running: [],
        },
      ],
    });
    await openPlan(opened);
    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain("a clone of the repository");
    expect(text).toContain("git pull, then pnpm install and pnpm build.");
    expect(text).toContain(
      "Ork runs only a package manager's own command from here; this one is yours to run.",
    );
    expect(
      dialog()
        .getAllByRole("button")
        .map(button => button.textContent),
    ).not.toContain("Upgrade to 0.4.0");
    expect(await violations(document.body)).toEqual([]);
  });

  it("says when the registry can't be reached, or this is the latest", async () => {
    const user = userEvent.setup();
    const opened = openUpgrade({
      plans: [{ kind: "unreachable" }, { kind: "latest", current: "0.3.0" }],
    });
    await connect(opened);
    act(() => {
      opened.state.version.openDialog("ask");
    });
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "Could not reach the npm registry to look for a new version.",
    );
    await user.click(dialog().getByRole("button", { name: "Try again" }));
    const latest = await dialog().findByRole("heading", {
      name: "Ork 0.3.0 is the latest version.",
    });
    await vi.waitFor(() => {
      expect(focused()).toBe(latest);
    });
  });
});

describe("running the upgrade", () => {
  it("streams the output into a focused region and can't be closed meanwhile", async () => {
    const opened = openUpgrade();
    const user = await openPlan(opened);
    const stream = await run(opened, user);
    expect(announced(opened)).toContain("Upgrading Ork to 0.4.0.");
    expect(stream.url).toBe("/api/upgrade/stream?after=0");
    act(() => {
      stream.send("output", { seq: 1, stream: "stdout", text: "Progress: 1" });
      stream.send("output", { seq: 2, stream: "stderr", text: "WARN old" });
    });
    const output = dialog().getByRole("region", { name: "Output of pnpm" });
    expect(output.textContent).toBe("Progress: 1\nWARN old");
    await vi.waitFor(() => {
      expect(focused()).toBe(output);
    });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      dialog()
        .getByRole("button", { name: "Close" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(await violations(document.body)).toEqual([]);
  });

  it("shows the job another tab started when one already runs", async () => {
    const opened = openUpgrade({
      upgrade: {
        status: 409,
        body: { error: "An upgrade is already running." },
      },
      version: { ...VERSION, job: JOB },
    });
    await openPlan(opened);
    await userEvent
      .setup()
      .click(dialog().getByRole("button", { name: "Upgrade to 0.4.0" }));
    await screen.findByRole("dialog", { name: "Upgrading Ork to 0.4.0" });
    expect(upgradeStream(opened).url).toBe("/api/upgrade/stream?after=0");
    expect(announced(opened)).toContain("An upgrade is already running.");
  });

  it("shows the new plan when it changed, with the server's words", async () => {
    const changed =
      "The plan changed since you read it: Ork 0.4.1 is out now. Read it again before upgrading.";
    const opened = openUpgrade({
      upgrade: { status: 409, body: { error: changed } },
      plans: [
        PLAN,
        {
          ...PLAN,
          planId: "plan-3",
          latest: "0.4.1",
          command: ["pnpm", "add", "--global", "@krapht/ork@0.4.1"],
        },
      ],
    });
    const user = await openPlan(opened);
    await user.click(
      dialog().getByRole("button", { name: "Upgrade to 0.4.0" }),
    );
    expect((await dialog().findByRole("alert")).textContent).toBe(changed);
    expect(
      dialog().getByRole("button", { name: "Upgrade to 0.4.1" }),
    ).toBeTruthy();
  });

  it("shows how it failed, with the command to run by hand", async () => {
    const opened = openUpgrade();
    const user = await openPlan(opened);
    await run(opened, user);
    end(opened, "failed", 1);
    const heading = await dialog().findByRole("heading", {
      name: "The upgrade did not finish",
    });
    await vi.waitFor(() => {
      expect(focused()).toBe(heading);
    });
    expect(dialog().getByRole("alert").textContent).toBe(
      `${COMMAND.join(" ")} failed (exit 1); the upgrade did not finish. Nothing was restarted; ork ui still runs 0.3.0.`,
    );
    expect(
      dialog().getByRole("button", { name: `Copy ${COMMAND.join(" ")}` }),
    ).toBeTruthy();
    expect(await violations(document.body)).toEqual([]);
  });
});

/** Runs the upgrade to its end, and waits for Upgraded to take the focus. */
const upgraded = async (opened: Opened) => {
  const user = await openPlan(opened);
  await run(opened, user);
  end(opened, "succeeded", 0);
  const heading = await dialog().findByRole("heading", {
    name: "Upgraded to 0.4.0",
  });
  await vi.waitFor(() => {
    expect(focused()).toBe(heading);
  });
  return user;
};

describe("the restart", () => {
  it("restarts, waits for the new server on the new version, and reloads", async () => {
    const opened = openUpgrade();
    const user = await upgraded(opened);
    expect(await violations(document.body)).toEqual([]);
    opened.server.health = [
      0,
      { version: "0.3.0", pid: 1, startedAt: "then" },
      { version: "0.4.0", pid: 2, startedAt: "now" },
    ];
    await user.click(dialog().getByRole("button", { name: "Restart" }));
    expect(opened.server.asked).toContain("POST /api/restart");
    await vi.waitFor(() => {
      expect(opened.reload).toHaveBeenCalledOnce();
    });
    expect(announced(opened)).toContain("Ork 0.4.0 is up. Reloading…");
    expect(screen.getByRole("dialog").textContent).toContain(
      "Ork 0.4.0 is up. Reloading…",
    );
  });

  it("can't be closed while it waits", async () => {
    const opened = openUpgrade();
    const user = await upgraded(opened);
    opened.server.health = [0];
    await user.click(dialog().getByRole("button", { name: "Restart" }));
    const heading = await dialog().findByRole("heading", {
      name: "Restarting ork ui…",
    });
    await vi.waitFor(() => {
      expect(focused()).toBe(heading);
    });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("gives up after a while, with the command to start it by hand", async () => {
    const opened = openUpgrade();
    const user = await upgraded(opened);
    opened.server.health = [0];
    await user.click(dialog().getByRole("button", { name: "Restart" }));
    await dialog().findByRole("heading", { name: "ork ui didn't come back" });
    expect(dialog().getByRole("alert").textContent).toContain(
      "after 60 seconds. Its terminal says why. Start it again there:",
    );
    expect(await violations(document.body)).toEqual([]);
    await user.click(dialog().getByRole("button", { name: "Keep waiting" }));
    expect(
      await dialog().findByRole("heading", { name: "Restarting ork ui…" }),
    ).toBeTruthy();
  });

  it("says when it came back on another version, or signed out", async () => {
    const opened = openUpgrade();
    const user = await upgraded(opened);
    opened.server.health = [{ version: "0.3.0", pid: 9, startedAt: "now" }];
    await user.click(dialog().getByRole("button", { name: "Restart" }));
    expect((await dialog().findByRole("alert")).textContent).toContain(
      "ork ui is back, but it runs 0.3.0: the ork it started is not the one that was upgraded.",
    );
    cleanup();
    const signedOut = openUpgrade();
    const again = await upgraded(signedOut);
    signedOut.server.health = [401];
    await again.click(dialog().getByRole("button", { name: "Restart" }));
    expect((await dialog().findByRole("alert")).textContent).toContain(
      "this page isn't signed in to it",
    );
    expect(opened.reload).not.toHaveBeenCalled();
  });

  it("keeps a refused restart in the dialog, with nothing stopped", async () => {
    const opened = openUpgrade({
      restart: {
        status: 400,
        body: {
          error: "This server can't restart itself; stop it and run `ork ui`.",
        },
      },
    });
    const user = await upgraded(opened);
    await user.click(dialog().getByRole("button", { name: "Restart" }));
    expect((await dialog().findByRole("alert")).textContent).toBe(
      "This server can't restart itself; stop it and run ork ui.",
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "Upgraded to 0.4.0",
      }),
    ).toBeTruthy();
  });
});
