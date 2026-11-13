/**
 * @file Tests that `loadRuntime` (what `ork run`, `ork chat` and the other
 *   commands that start a session use) hands a real session the guarded-store
 *   list of a nested run (ADR-047): the session of a run started inside another
 *   run's store sees both that store and its own in `ORK_GUARDED_STORES`, the
 *   run's own identity (`ORK_RUN`) stays out, and `ORK_SESSION` is set. The
 *   `claude` on `PATH` is a shim that records its environment, then runs the
 *   runtime's stand-in `claude`.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { storePath } from "@krapht/ork-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadRuntime } from "../src/commands/run.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime/test/fixtures/fake-claude.mjs",
);

const human = {
  permit: () => Promise.resolve({ allow: true as const }),
  ask: () => Promise.resolve("a"),
};

/** The names the shim records, one `NAME=value` line each. */
const SEEN = ["ORK_RUN", "ORK_SESSION", "ORK_GUARDED_STORES"] as const;

/**
 * A folder with a `claude` that records `SEEN` in `seen.txt`, then runs the
 * stand-in.
 */
const shimmed = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-guard-env-")));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  const shim = path.join(bin, "claude");
  const record = SEEN.map(
    name => `echo "${name}=\${${name}-<unset>}" >> "${dir}/seen.txt"`,
  ).join("\n");
  writeFileSync(
    shim,
    `#!/bin/sh\n${record}\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return {
    dir,
    seen: path.join(dir, "seen.txt"),
    path: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
  };
};

/** The recorded variables of the first session the shim ran. */
const recorded = (file: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(line => line !== "")
      .slice(0, SEEN.length)
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );

/** Starts a session through `loadRuntime` and drains it. */
const runSession = async (): Promise<void> => {
  const runtime = await loadRuntime("claude-code");
  const session = runtime.start(
    {
      nodeId: "write",
      cwd: process.cwd(),
      prompt: "Write the notes",
      systemAppend: "# Ork",
      settingSources: ["project", "local"],
      tools: { allow: [], deny: [] },
      permissionMode: "default",
      reportSchema: { type: "object" },
    },
    { human },
  );
  // Drained: the shim has recorded by the time the session ends.
  const events: unknown[] = [];
  for await (const event of session.events) events.push(event);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadRuntime in a nested run", () => {
  it("hands its session the stores the outer run guards, and its own", async () => {
    const shim = shimmed();
    const outer = path.join(shim.dir, "outer", ".ork", "state.db");
    vi.stubEnv("HOME", shim.dir);
    vi.stubEnv("PATH", shim.path);
    vi.stubEnv("ORK_RUN", "outer-run");
    vi.stubEnv("ORK_GUARDED_STORES", JSON.stringify([outer]));

    await runSession();

    const seen = recorded(shim.seen);
    expect(seen["ORK_RUN"]).toBe("<unset>");
    expect(seen["ORK_SESSION"]).toBe("1");
    expect(seen["ORK_GUARDED_STORES"]).toBe(
      JSON.stringify([outer, storePath(shim.dir)]),
    );
  });
});
