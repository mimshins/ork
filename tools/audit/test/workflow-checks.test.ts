/**
 * @file Tests the workflow checks on fixture workflows: an action pinned to a
 *   tag, a job with no `permissions`, `pull_request_target` with a checkout,
 *   and a clean workflow (a SHA with its tag in a comment, a local action).
 */

import { describe, expect, it } from "vitest";

import { checkWorkflow } from "../workflow-checks.ts";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const workflow = (on: string, uses: string, jobPermissions: string): string =>
  [
    "name: t",
    `on: ${on}`,
    "permissions: {}",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-24.04",
    jobPermissions,
    "    steps:",
    `      - uses: ${uses}`,
    "      - uses: ./.github/actions/setup",
    "      - run: pnpm test",
  ]
    .filter(line => line !== "")
    .join("\n");

const checks = (text: string): string[] =>
  checkWorkflow(".github/workflows/t.yml", text).map(record => record.check);

describe("checkWorkflow", () => {
  it("flags an action pinned to a tag, with its line", () => {
    const records = checkWorkflow(
      ".github/workflows/t.yml",
      workflow(
        "push",
        "actions/checkout@v4",
        "    permissions:\n      contents: read",
      ),
    );
    expect(records).toMatchObject([
      { check: "unpinned-action", file: ".github/workflows/t.yml", line: 10 },
    ]);
    expect(records[0]?.title).toContain("actions/checkout@v4");
  });

  it("flags a container image with no digest, not a local action", () => {
    expect(
      checks(workflow("push", "docker://alpine:3", "    permissions: {}")),
    ).toEqual(["unpinned-action"]);
  });

  it("flags a job with no permissions even under a workflow-level block", () => {
    const records = checkWorkflow(
      ".github/workflows/t.yml",
      workflow("push", `actions/checkout@${SHA} # v7`, ""),
    );
    expect(records).toMatchObject([{ check: "missing-permissions" }]);
    expect(records[0]?.title).toContain("job build");
  });

  it("flags pull_request_target with a checkout", () => {
    expect(
      checks(
        workflow(
          "[pull_request_target]",
          `actions/checkout@${SHA}`,
          "    permissions:\n      contents: read",
        ),
      ),
    ).toEqual(["pull-request-target-checkout"]);
  });

  it("is quiet for a pinned, permissioned, ordinary workflow", () => {
    expect(
      checks(
        workflow(
          "push",
          `actions/checkout@${SHA} # v7`,
          "    permissions:\n      contents: read",
        ),
      ),
    ).toEqual([]);
  });
});
