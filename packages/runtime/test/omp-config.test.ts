/**
 * @file The `omp` driver's session files (`omp-config.ts`): the `--tools` list
 *   against a node's rules (a table), the overlay's approvals generated from
 *   the same list, Ork's host tools allowed by name, the YAML it is written in,
 *   the hold file (the only one with the token), and the private folder's modes
 *   and removal, a failed write included.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { OrkEndpoint } from "../src/adapter.ts";
import {
  ompTools,
  overlayOf,
  writeOmpSession,
  yamlOf,
} from "../src/adapters/omp-config.ts";
import { ORK_TOOLS } from "../src/tools/registry.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const specOf = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  nodeId: "omp",
  cwd: temp("ork-omp-cwd-"),
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
  reading: "open",
  ...over,
});

const rules = (
  allow: string[],
  deny: string[] = [],
  only?: string[],
): Partial<SessionSpec> => ({
  tools: { allow, deny, ...(only === undefined ? {} : { only }) },
});

const ENDPOINT: OrkEndpoint = {
  url: "http://127.0.0.1:47831/mcp",
  token: "TOKEN-omp-config",
};

const HELD: OrkEndpoint = {
  ...ENDPOINT,
  holdUrl: "http://127.0.0.1:47831/hold",
};

const ApprovalSchema = z.object({
  tools: z.object({ approval: z.record(z.string(), z.string()) }),
});

const approval = (spec: SessionSpec): Record<string, string> =>
  ApprovalSchema.parse(overlayOf(spec)).tools.approval;

const allowed = (spec: SessionSpec): string[] =>
  Object.entries(approval(spec))
    .filter(([name, value]) => value === "allow" && !name.startsWith("ork_"))
    .map(([name]) => name);

describe("ompTools", () => {
  it.each<[string, Partial<SessionSpec>, string[]]>([
    ["a node with no rules reads only", {}, ["read", "grep", "glob"]],
    [
      "a readonly node (shell reads allowed)",
      rules(["Bash(git status)"], ["Edit", "Write"]),
      ["read", "bash", "grep", "glob"],
    ],
    [
      "plan mode leaves out edit, write and bash",
      { ...rules(["Edit", "Bash"]), permissionMode: "plan" },
      ["read", "grep", "glob"],
    ],
    [
      "acceptEdits offers edit and write",
      { permissionMode: "acceptEdits" },
      ["read", "edit", "write", "grep", "glob"],
    ],
    [
      "--yolo offers every built-in its denies leave",
      { ...rules([], ["Bash"]), yolo: true },
      ["read", "edit", "write", "grep", "glob"],
    ],
    [
      "only limits the built-ins",
      { ...rules(["Bash", "Edit"], [], ["Read", "Bash"]), yolo: false },
      ["read", "bash", "grep", "glob"],
    ],
    [
      "a shell prefix deny keeps bash",
      rules(["Bash"], ["Bash(rm:*)"]),
      ["read", "bash", "grep", "glob"],
    ],
    [
      "the withheld Grep and Glob (bare denies)",
      { ...rules([], ["Grep", "Glob"]), reading: "extract" },
      ["read"],
    ],
    [
      "a path-scoped Read deny takes all three reads",
      rules(["Bash"], ["Read(./secret/**)"]),
      ["bash"],
    ],
    [
      "a path-scoped Glob deny takes all three reads",
      rules(["Edit"], ["Glob(*.env)"]),
      ["edit", "write"],
    ],
    [
      "a path-scoped Edit deny takes edit and write",
      rules(["Edit"], ["Edit(src/**)"]),
      ["read", "grep", "glob"],
    ],
    ["nothing left is read alone", rules([], ["Read"]), ["read"]],
  ])("%s", (_name, over, tools) => {
    expect(ompTools(specOf(over))).toEqual(tools);
  });

  it("never offers eval or task, and only omp's six names", () => {
    const tools = ompTools(specOf({ yolo: true }));
    expect(tools).not.toContain("eval");
    expect(tools).not.toContain("task");
    expect(
      tools.every(tool =>
        ["read", "edit", "write", "bash", "grep", "glob"].includes(tool),
      ),
    ).toBe(true);
  });
});

describe("overlayOf", () => {
  it("allows what --tools offers and denies the other built-ins, eval and task", () => {
    const spec = specOf(rules(["Bash"], ["Read(./secret/**)"]));
    expect(allowed(spec)).toEqual(ompTools(spec));
    expect(approval(spec)).toMatchObject({
      bash: "allow",
      read: "deny",
      grep: "deny",
      glob: "deny",
      edit: "deny",
      write: "deny",
      eval: "deny",
      task: "deny",
    });
  });

  it("denies read when it is only the fallback", () => {
    const spec = specOf(rules([], ["Read"]));
    expect(ompTools(spec)).toEqual(["read"]);
    expect(approval(spec)).toMatchObject({ read: "deny" });
  });

  it("allows each Ork host tool by its own name, and denies one the node denies", () => {
    const names = ORK_TOOLS.map(tool => `ork_${tool.name}`).toSorted();
    const keys = Object.keys(approval(specOf()));
    expect(keys.filter(name => name.startsWith("ork_")).toSorted()).toEqual(
      names,
    );
    expect(keys.filter(name => name.startsWith("mcp__"))).toEqual([]);
    expect(approval(specOf(rules([], ["mcp__ork__ask_user"])))).toMatchObject({
      ork_ask_user: "deny",
      ork_report: "allow",
    });
  });

  it("turns off omp's own features and other tools' sources", () => {
    const overlay = overlayOf(specOf());
    expect(overlay).toMatchObject({
      tools: { xdev: false, approvalMode: "always-ask" },
      advisor: { enabled: false },
      prewalk: { auto: "off" },
      memory: { backend: "off" },
      retry: { modelFallback: false, waitForUsageReset: false },
      mcp: { enableProjectConfig: false },
    });
    expect(overlay["disabledProviders"]).toContain("claude-plugins");
    expect(overlay).not.toHaveProperty("extensionHandlers");
  });

  it("gives the guard's handler more than two hold windows", () => {
    expect(overlayOf(specOf(), 1000)).toMatchObject({
      extensionHandlers: { toolCallTimeoutMs: 62_000 },
    });
  });
});

describe("yamlOf", () => {
  it("writes nested block YAML with quoted strings and flow lists", () => {
    expect(yamlOf({ a: { b: false, c: "off" }, d: ["x", "y"], e: 3 })).toBe(
      'a:\n  b: false\n  c: "off"\nd: ["x","y"]\ne: 3\n',
    );
  });
});

const jsonOf = (text: string | undefined): unknown => JSON.parse(text ?? "");

/** Whether every path is absolute and outside `cwd`. */
const outside = (cwd: string, paths: string[]): boolean =>
  paths.every(each => path.isAbsolute(each) && !each.startsWith(cwd));

/** Every file under `dir`, relative to it. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();

describe("writeOmpSession", () => {
  it("writes a private folder outside the checkout, removed after", () => {
    const spec = specOf();
    const files = writeOmpSession(spec, HELD, {
      guard: "export default () => {};\n",
      holdWindowMs: 1000,
      root: temp("ork-omp-root-"),
    });
    expect(outside(spec.cwd, [files.dir, files.overlay, files.guard])).toBe(
      true,
    );
    expect(statSync(files.dir).mode & 0o777).toBe(0o700);
    expect(filesUnder(files.dir)).toEqual([
      "guard.mjs",
      "hold.json",
      "overlay.yml",
    ]);
    expect(
      filesUnder(files.dir).map(
        name => statSync(path.join(files.dir, name)).mode & 0o777,
      ),
    ).toEqual([0o600, 0o600, 0o600]);
    // The token is in hold.json only.
    expect(
      filesUnder(files.dir).filter(name =>
        readFileSync(path.join(files.dir, name), "utf8").includes(HELD.token),
      ),
    ).toEqual(["hold.json"]);
    expect(
      jsonOf(readFileSync(path.join(files.dir, "hold.json"), "utf8")),
    ).toEqual({
      url: HELD.holdUrl,
      token: HELD.token,
    });
    expect(readFileSync(files.overlay, "utf8")).toContain(
      "  toolCallTimeoutMs: 62000\n",
    );
    expect(readFileSync(files.guard, "utf8")).toBe(
      "export default () => {};\n",
    );
    files.remove();
    expect(existsSync(files.dir)).toBe(false);
  });

  it("writes no hold file and no handler timeout without a hold endpoint", () => {
    const files = writeOmpSession(specOf(), ENDPOINT, {
      guard: "",
      holdWindowMs: 1000,
      root: temp("ork-omp-root-"),
    });
    expect(files.hold).toBeUndefined();
    expect(existsSync(path.join(files.dir, "hold.json"))).toBe(false);
    expect(readFileSync(files.overlay, "utf8")).not.toContain(
      "extensionHandlers",
    );
    files.remove();
  });

  it("removes the folder when a write throws part-way", () => {
    const root = temp("ork-omp-root-");
    const broken = {
      ...HELD,
      get token(): string {
        throw new Error("no token");
      },
    };
    expect(() =>
      writeOmpSession(specOf(), broken, {
        guard: "",
        holdWindowMs: 1000,
        root,
      }),
    ).toThrow("no token");
    expect(readdirSync(root)).toEqual([]);
  });
});
