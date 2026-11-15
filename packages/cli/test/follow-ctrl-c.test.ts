/**
 * @file Tests that Ctrl-C on a real terminal ends `ork decide --follow` and
 *   `ork logs -f --all` with exit code 0, through their own SIGINT handlers:
 *   without one, the signal would end the process with 130. Each runs on a pty
 *   (`script`), and a decision it leaves stays open.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type EventStore, openStore, storePath } from "@krapht/ork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasPty, orkOnPty, type PtyOrk } from "./pty.ts";

const CTRL_C = "\u0003";

/** A run recorded by this process, so it reads as live, with a gate open. */
const liveRunAsking = (store: EventStore): void => {
  store.begin({ id: "live0000", workflow: "w", file: "f", project: "/p" });
  store.append("live0000", {
    type: "run.started",
    runId: "live0000",
    workflow: "w",
    entries: [],
    nodes: [{ id: "gate", type: "human.gate" }],
  });
  const options = [{ id: "approve" }, { id: "revise" }];
  store.openDecision({
    id: "live-1",
    runId: "live0000",
    node: "gate",
    kind: "question",
    question: "Approve live-1?",
    options,
  });
  store.append("live0000", {
    type: "decision.opened",
    node: "gate",
    decision: "live-1",
    kind: "question",
    question: "Approve live-1?",
    options,
  });
};

describe.skipIf(!hasPty)("Ctrl-C on a terminal", () => {
  let home: string;
  let store: EventStore;
  let ork: PtyOrk | undefined;

  const start = (args: readonly string[]): PtyOrk => {
    ork = orkOnPty(args, {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      NO_COLOR: "1",
      ORK_NO_UPDATE_CHECK: "1",
    });
    return ork;
  };

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "ork-follow-ctrl-c-"));
    store = openStore(storePath(home));
    liveRunAsking(store);
  });

  afterEach(() => {
    ork?.child.kill("SIGKILL");
    ork?.keys.destroy();
    ork = undefined;
    store.close();
  });

  it("ends ork decide --follow at its prompt with exit 0, leaving the decision open", async () => {
    const follow = start(["decide", "--follow", "--project", "all"]);
    await vi.waitFor(
      () => {
        expect(follow.output()).toContain("Approve live-1?");
      },
      { timeout: 15_000 },
    );
    follow.keys.write(CTRL_C);

    await expect(follow.exited).resolves.toBe(0);
    expect(follow.output()).toContain(
      "stopped following; 1 decision(s) still open",
    );
    expect(store.decision("live-1")?.status).toBe("open");
  });

  it("ends ork logs -f --all with exit 0", async () => {
    const logs = start(["logs", "-f", "--all", "--project", "all"]);
    await vi.waitFor(
      () => {
        expect(logs.output()).toContain("live0000");
      },
      { timeout: 15_000 },
    );
    logs.keys.write(CTRL_C);

    await expect(logs.exited).resolves.toBe(0);
  });
});
