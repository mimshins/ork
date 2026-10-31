/** @file Tests for `ork doctor`'s checks, against a fake `exec`. */

import type { Exec } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

import { checkNode, formatCheck, runChecks } from "../src/index.ts";

/** A fake `exec`: maps "program arg arg" to stdout; anything else fails. */
const fakeExec =
  (outputs: Record<string, string>): Exec =>
  (program, args) => {
    const key = [program, ...args].join(" ");
    const stdout = outputs[key];
    return Promise.resolve(
      stdout === undefined ? { ok: false, stdout: "" } : { ok: true, stdout },
    );
  };

const loggedIn = {
  "git --version": "git version 2.50.0\n",
  "git rev-parse --is-inside-work-tree": "true\n",
  "git config user.name": "Some One\n",
  "git config user.email": "someone@example.com\n",
  "claude --version": "2.1.314 (Claude Code)\n",
  "claude auth status --json": JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    email: "someone@example.com",
  }),
  "gh --version": "gh version 2.80.0\n",
  "gh auth status --json hosts": JSON.stringify({
    hosts: {
      "github.com": [{ active: true, state: "success", login: "octocat" }],
    },
  }),
};

describe("ork doctor", () => {
  it("passes with the CLI driver logged in, and never prints the email", async () => {
    const { results, ok } = await runChecks(fakeExec(loggedIn), {}, "24.20.0");
    expect(ok).toBe(true);
    expect(results.map(r => `${r.name}: ${r.status}`)).toEqual([
      "node: ok",
      "git: ok",
      "git repo: ok",
      "claude (sdk driver): warn",
      "claude (cli driver): ok",
      "gh: ok",
      "aws: skip",
      "git identity: ok",
    ]);
    expect(JSON.stringify(results)).not.toContain("someone@example.com");
  });

  it("accepts an API key or a cloud provider for the SDK driver", async () => {
    const run = fakeExec({ "git --version": "git version 2.50.0" });
    const withKey = await runChecks(run, { ANTHROPIC_API_KEY: "x" }, "24.20.0");
    const withBedrock = await runChecks(
      run,
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      "24.20.0",
    );
    expect(withKey.ok).toBe(true);
    expect(withBedrock.results[3]?.detail).toBe("Amazon Bedrock");
    expect(JSON.stringify(withKey.results)).not.toContain('"x"');
  });

  it("fails without any Claude driver", async () => {
    const { ok, results } = await runChecks(
      fakeExec({ "git --version": "git version 2.50.0" }),
      {},
      "24.20.0",
    );
    expect(ok).toBe(false);
    expect(results.find(r => r.name === "claude (cli driver)")?.status).toBe(
      "warn",
    );
  });

  it("fails on an old Node or a missing git", async () => {
    expect(checkNode("22.12.0").status).toBe("fail");
    expect(checkNode("24.20.1").status).toBe("ok");
    const { ok } = await runChecks(fakeExec(loggedIn), {}, "24.2.0");
    expect(ok).toBe(false);
  });

  it("prints a hint under a problem", () => {
    expect(
      formatCheck({ name: "gh", status: "warn", detail: "d", hint: "do x" }),
    ).toEqual(["! gh                   d", "  do x"]);
  });
});
