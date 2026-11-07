/**
 * @file Tests for `ork ui`'s supervisor (ADR-060), with fake children: the port
 *   and the token go over the channel after the child says hello; a restart
 *   starts one new child on the bound port with the same token, never a second
 *   alongside; a new server that doesn't start is reported with the command to
 *   start it by hand; Ctrl-C stops the one child, and no restart follows it. No
 *   real server is started or restarted.
 */

import { describe, expect, it } from "vitest";

import {
  type Ready,
  type ServerChild,
  supervise,
} from "../src/browser/supervise.ts";

const ignore = (): void => {};

type FakeChild = {
  child: ServerChild;
  sent: unknown[];
  killed: string[];
  message: (value: unknown) => void;
  exit: (code: number | null) => void;
};

const fakeChild = (): FakeChild => {
  const fake: FakeChild = {
    sent: [],
    killed: [],
    message: ignore,
    exit: ignore,
    child: {
      send: message => {
        fake.sent.push(message);
      },
      kill: signal => {
        fake.killed.push(signal);
      },
      onMessage: listener => {
        fake.message = listener;
      },
      onExit: listener => {
        fake.exit = listener;
      },
    },
  };
  return fake;
};

/** A supervisor on fake children, and what it said and did. */
const supervised = (port = 4417) => {
  const children: FakeChild[] = [];
  const readies: Ready[] = [];
  const said: string[] = [];
  const errors: string[] = [];
  let stop: (signal: NodeJS.Signals) => void = ignore;
  const code = supervise({
    port,
    token: "secret-token",
    spawnServer: () => {
      const fake = fakeChild();
      children.push(fake);
      return fake.child;
    },
    onReady: ready => {
      readies.push(ready);
    },
    onStop: listener => {
      stop = listener;
    },
    say: line => {
      said.push(line);
    },
    sayErr: line => {
      errors.push(line);
    },
  });
  const nth = (index: number): FakeChild => {
    const child = children[index];
    if (child === undefined) throw new Error(`No child ${String(index)}.`);
    return child;
  };
  /** The child at `index` says hello, then serves on `served`. */
  const serves = (index: number, served: number, version = "0.3.0") => {
    nth(index).message({ type: "ork-ui-hello" });
    nth(index).message({ type: "ork-ui-ready", port: served, version });
  };
  return {
    code,
    children,
    readies,
    said,
    errors,
    nth,
    serves,
    stop: (signal: NodeJS.Signals) => {
      stop(signal);
    },
  };
};

describe("ork ui's supervisor", () => {
  it("hands the port and the token over the channel, after hello", async () => {
    const ui = supervised(0);
    expect(ui.nth(0).sent).toEqual([]);
    ui.serves(0, 51_234);
    expect(ui.nth(0).sent).toEqual([
      { type: "ork-ui-start", port: 0, token: "secret-token" },
    ]);
    expect(ui.readies).toEqual([
      { port: 51_234, version: "0.3.0", restarted: false },
    ]);
    ui.stop("SIGINT");
    expect(ui.nth(0).killed).toEqual(["SIGINT"]);
    ui.nth(0).exit(0);
    expect(await ui.code).toBe(0);
    expect(ui.said).toEqual(["Ork's UI stopped."]);
  });

  it("restarts onto one new child, on the bound port with the same token", async () => {
    const ui = supervised(0);
    ui.serves(0, 51_234);
    ui.nth(0).message({ type: "ork-ui-restart" });
    ui.nth(0).exit(0);
    expect(ui.children).toHaveLength(2);
    ui.serves(1, 51_234, "0.4.0");
    expect(ui.nth(1).sent).toEqual([
      { type: "ork-ui-start", port: 51_234, token: "secret-token" },
    ]);
    expect(ui.readies.at(-1)).toEqual({
      port: 51_234,
      version: "0.4.0",
      restarted: true,
    });
    ui.stop("SIGTERM");
    expect(ui.nth(0).killed).toEqual([]);
    expect(ui.nth(1).killed).toEqual(["SIGTERM"]);
    ui.nth(1).exit(0);
    expect(await ui.code).toBe(0);
    expect(ui.children).toHaveLength(2);
  });

  it("says how to start it by hand when the new server doesn't start", async () => {
    const ui = supervised();
    ui.serves(0, 4417);
    ui.nth(0).message({ type: "ork-ui-restart" });
    ui.nth(0).exit(0);
    ui.nth(1).message({ type: "ork-ui-hello" });
    ui.nth(1).message({
      type: "ork-ui-failed",
      error:
        "Port 4417 is in use; start Ork's UI on another with `--port <n>`.",
    });
    ui.nth(1).exit(1);
    expect(await ui.code).toBe(1);
    expect(ui.errors).toEqual([
      "Port 4417 is in use; start Ork's UI on another with `--port <n>`.",
      "Ork's UI did not start again (exit 1). Start it with: ork ui --port 4417",
    ]);
    expect(ui.children).toHaveLength(2);
  });

  it("ends with the child's code when the first start fails", async () => {
    const ui = supervised();
    ui.nth(0).message({ type: "ork-ui-hello" });
    ui.nth(0).message({ type: "ork-ui-failed", error: "No store." });
    ui.nth(0).exit(1);
    expect(await ui.code).toBe(1);
    expect(ui.errors).toEqual(["No store."]);
    expect(ui.readies).toEqual([]);
  });

  it("doesn't restart after Ctrl-C, even when a restart was asked", async () => {
    const ui = supervised();
    ui.serves(0, 4417);
    ui.nth(0).message({ type: "ork-ui-restart" });
    ui.stop("SIGINT");
    ui.nth(0).exit(null);
    expect(await ui.code).toBe(0);
    expect(ui.children).toHaveLength(1);
  });

  it("ignores what isn't one of its messages", async () => {
    const ui = supervised();
    ui.nth(0).message("ork-ui-ready");
    ui.nth(0).message({ type: "ork-ui-ready", port: "4417" });
    expect(ui.readies).toEqual([]);
    ui.nth(0).exit(1);
    expect(await ui.code).toBe(1);
  });
});
