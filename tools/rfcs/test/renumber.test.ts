/**
 * @file Tests renumbering a commit's RFCs against a fetched upstream: the pure
 *   text and index functions, and the tool on real repositories with a bare
 *   remote.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  renumber,
  renumberIndex,
  renumberText,
  takenNumbers,
} from "../renumber.ts";

const SCRIPT = fileURLToPath(new URL("../renumber.ts", import.meta.url));

const THEIRS = "RFC-027-theirs.md";
const OURS = "RFC-027-ours.md";
const OURS_2 = "RFC-028-second.md";

const HEAD = [
  "| RFC                                           | Title        | Status      |",
  "| --------------------------------------------- | ------------ | ----------- |",
  "| [026](./archived/RFC-026-old-one.md)          | Old one      | Implemented |",
].join("\n");

const row = (number: string, file: string, title: string): string =>
  `| [${number}](./active/${file}) | ${title} | Accepted |`;

const rfc = (number: string, title: string): string =>
  `# RFC-${number} — ${title}\n\n- **Status:** Accepted\n\nSee RFC-${number} and RFC-0${number}.\n`;

const made: string[] = [];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

const put = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

const read = (root: string, file: string): string =>
  readFileSync(path.join(root, file), "utf8");

const identify = (root: string): void => {
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
};

type World = { remote: string; ours: string; upstream: string };

/**
 * A bare remote at main, a clone that will hold our commit, and one for
 * upstream.
 */
const world = (): World => {
  const base = mkdtempSync(path.join(tmpdir(), "ork-rfc-renumber-"));
  made.push(base);
  const remote = path.join(base, "remote.git");
  const seed = path.join(base, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", "-q", remote, seed], { stdio: "pipe" });
  identify(seed);
  git(seed, "checkout", "-q", "-b", "main");
  put(seed, "rfcs/README.md", `# RFCs\n\n${HEAD}\n`);
  put(seed, "rfcs/archived/RFC-026-old-one.md", rfc("026", "Old one"));
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "base");
  git(seed, "push", "-q", "origin", "main");
  const ours = path.join(base, "ours");
  const upstream = path.join(base, "upstream");
  for (const clone of [ours, upstream]) {
    execFileSync("git", ["clone", "-q", remote, clone], { stdio: "pipe" });
    identify(clone);
  }
  return { remote, ours, upstream };
};

/** Upstream publishes its RFC-027 to main; ours fetches it. */
const upstreamTakes = (w: World): void => {
  const index = read(w.upstream, "rfcs/README.md");
  put(w.upstream, `rfcs/active/${THEIRS}`, rfc("027", "Theirs"));
  put(
    w.upstream,
    "rfcs/README.md",
    `${index.trimEnd()}\n${row("027", THEIRS, "Theirs")}\n`,
  );
  git(w.upstream, "add", "-A");
  git(w.upstream, "commit", "-q", "-m", "theirs");
  git(w.upstream, "push", "-q", "origin", "main");
  git(w.ours, "fetch", "-q", "origin", "main");
};

/** Our commit: RFC-027 and its row, plus `extra` files. */
const commitOurs = (
  w: World,
  extra: Record<string, string> = {},
  files: string[] = [OURS],
): void => {
  const index = read(w.ours, "rfcs/README.md");
  const rows = files.map(file => {
    const number = file.slice(4, 7);
    put(w.ours, `rfcs/active/${file}`, rfc(number, "Ours"));
    return row(number, file, "Ours");
  });
  put(w.ours, "rfcs/README.md", `${index.trimEnd()}\n${rows.join("\n")}\n`);
  for (const [file, text] of Object.entries(extra)) {
    put(w.ours, file, text);
  }
  git(w.ours, "add", "-A");
  git(w.ours, "commit", "-q", "-m", "Add RFCs\n\nbody");
};

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("takenNumbers", () => {
  it("maps numbers to file names across active and archived", () => {
    const taken = takenNumbers([
      "rfcs/active/RFC-027-a.md",
      "rfcs/archived/RFC-003-b.md",
      "rfcs/README.md",
      "docs/RFC-099-x.md",
    ]);
    expect([...taken]).toEqual([
      [27, "RFC-027-a.md"],
      [3, "RFC-003-b.md"],
    ]);
  });
});

describe("renumberText", () => {
  it("replaces the number on a digit boundary, in text and file names", () => {
    expect(renumberText("RFC-027 RFC-0270 RFC-027-a.md RFC-026", 27, 29)).toBe(
      "RFC-029 RFC-0270 RFC-029-a.md RFC-026",
    );
  });

  it("matches a four-digit number whole, not as the start of a longer one", () => {
    expect(renumberText("RFC-1000 RFC-10001 RFC-100", 1000, 1001)).toBe(
      "RFC-1001 RFC-10001 RFC-100",
    );
  });

  it("replaces the number at the end of the text", () => {
    expect(renumberText("see RFC-027", 27, 29)).toBe("see RFC-029");
  });

  it("replaces the number before `.`, `)` and `,`", () => {
    expect(renumberText("RFC-027. (RFC-027) RFC-027, RFC-027", 27, 29)).toBe(
      "RFC-029. (RFC-029) RFC-029, RFC-029",
    );
  });

  it("leaves a longer number alone", () => {
    expect(renumberText("RFC-0270 RFC-02700 RFC-0271.", 27, 29)).toBe(
      "RFC-0270 RFC-02700 RFC-0271.",
    );
  });
});

describe("renumberIndex", () => {
  const ours = row("027", OURS, "Ours");

  it("adds the row after the last RFC row and pads the table", () => {
    const out = renumberIndex(`${HEAD}\n`, ours, 27, 28, OURS).split("\n");
    expect(out[3]).toMatch(
      /^\| \[028\]\(\.\/active\/RFC-028-ours\.md\) +\| Ours +\| Accepted +\|$/u,
    );
    expect(new Set(out.slice(0, 4).map(line => line.length)).size).toBe(1);
  });

  it("replaces the row that links the old file", () => {
    const out = renumberIndex(`${HEAD}\n${ours}\n`, ours, 27, 29, OURS);
    expect(out).toContain("[029](./active/RFC-029-ours.md)");
    expect(out).not.toContain("[027]");
  });

  it("keeps upstream's row of the same number", () => {
    const upstream = `${HEAD}\n${row("027", THEIRS, "Theirs")}\n`;
    const out = renumberIndex(upstream, ours, 27, 28, OURS);
    expect(out).toContain(`[027](./active/${THEIRS})`);
    expect(out).toContain("[028](./active/RFC-028-ours.md)");
  });
});

describe("renumber", () => {
  it("replays an RFC-only commit on the upstream tip", () => {
    const w = world();
    commitOurs(w);
    upstreamTakes(w);
    const done = renumber(w.ours, ["origin/main"]);
    expect(done).toEqual([
      {
        from: 27,
        to: 28,
        path: "rfcs/active/RFC-028-ours.md",
        reason: "RFC-027 is on origin/main",
      },
    ]);
    expect(git(w.ours, "rev-list", "--count", "origin/main..HEAD")).toBe("1");
    expect(git(w.ours, "rev-parse", "HEAD~1")).toBe(
      git(w.ours, "rev-parse", "origin/main"),
    );
    expect(git(w.ours, "log", "-1", "--format=%B")).toBe("Add RFCs\n\nbody");
    expect(existsSync(path.join(w.ours, "rfcs/active", OURS))).toBe(false);
    expect(read(w.ours, "rfcs/active/RFC-028-ours.md")).toContain(
      "# RFC-028 — Ours\n\n- **Status:** Accepted\n\nSee RFC-028 and RFC-0027.",
    );
    expect(read(w.ours, `rfcs/active/${THEIRS}`)).toContain("# RFC-027 —");
    const index = read(w.ours, "rfcs/README.md");
    expect(index).toContain(`[027](./active/${THEIRS})`);
    expect(index).toContain("[028](./active/RFC-028-ours.md)");
    expect(git(w.ours, "status", "--porcelain")).toBe("");
    git(w.ours, "rebase", "origin/main");
    expect(git(w.ours, "rev-list", "--count", "origin/main..HEAD")).toBe("1");
  });

  it("gives several added RFCs consecutive numbers", () => {
    const w = world();
    commitOurs(w, {}, [OURS, OURS_2]);
    upstreamTakes(w);
    const done = renumber(w.ours, ["origin/main"]);
    expect(done.map(d => [d.from, d.to])).toEqual([
      [27, 28],
      [28, 29],
    ]);
    expect(existsSync(path.join(w.ours, "rfcs/active", OURS_2))).toBe(false);
    expect(read(w.ours, "rfcs/active/RFC-029-second.md")).toContain(
      "# RFC-029 —",
    );
    expect(read(w.ours, "rfcs/README.md")).toContain(
      "[029](./active/RFC-029-second.md)",
    );
  });

  it("renumbers in place when the commit touches other files", () => {
    const w = world();
    commitOurs(w, {
      "specs/a.md": `See [ours](../rfcs/active/${OURS}) and RFC-027 upstream.\n`,
    });
    const before = git(w.ours, "rev-parse", "HEAD~1");
    upstreamTakes(w);
    expect(renumber(w.ours, ["origin/main"]).map(d => d.to)).toEqual([28]);
    expect(git(w.ours, "rev-parse", "HEAD~1")).toBe(before);
    expect(read(w.ours, "specs/a.md")).toBe(
      "See [ours](../rfcs/active/RFC-028-ours.md) and RFC-027 upstream.\n",
    );
    expect(read(w.ours, "rfcs/README.md")).toContain(
      "[028](./active/RFC-028-ours.md)",
    );
    expect(git(w.ours, "status", "--porcelain")).toBe("");
  });

  it("checks every ref and takes the highest number plus one", () => {
    const w = world();
    commitOurs(w);
    upstreamTakes(w);
    git(w.upstream, "checkout", "-q", "-b", "side");
    put(w.upstream, "rfcs/active/RFC-031-side.md", rfc("031", "Side"));
    git(w.upstream, "add", "-A");
    git(w.upstream, "commit", "-q", "-m", "side");
    git(w.upstream, "push", "-q", "origin", "side");
    git(w.ours, "fetch", "-q", "origin", "side");
    const done = renumber(w.ours, ["origin/side", "origin/main"]);
    expect(done.map(d => d.to)).toEqual([32]);
  });

  it("moves a number only the last ref, named with a slash, holds, above every ref", () => {
    const w = world();
    commitOurs(w);
    git(w.upstream, "checkout", "-q", "-b", "side");
    put(w.upstream, "rfcs/active/RFC-029-side.md", rfc("029", "Side"));
    git(w.upstream, "add", "-A");
    git(w.upstream, "commit", "-q", "-m", "side");
    git(w.upstream, "push", "-q", "origin", "side");
    git(w.upstream, "checkout", "-q", "main");
    git(w.upstream, "checkout", "-q", "-b", "feature/tip");
    put(w.upstream, `rfcs/active/${THEIRS}`, rfc("027", "Theirs"));
    git(w.upstream, "add", "-A");
    git(w.upstream, "commit", "-q", "-m", "tip");
    git(w.upstream, "push", "-q", "origin", "feature/tip");
    git(w.ours, "fetch", "-q", "origin", "side", "feature/tip");
    const done = renumber(w.ours, ["origin/side", "origin/feature/tip"]);
    expect(done).toEqual([
      {
        from: 27,
        to: 30,
        path: "rfcs/active/RFC-030-ours.md",
        reason: "RFC-027 is on origin/feature/tip",
      },
    ]);
    expect(git(w.ours, "rev-parse", "HEAD~1")).toBe(
      git(w.ours, "rev-parse", "origin/feature/tip"),
    );
  });

  it("changes nothing when the number is free", () => {
    const w = world();
    commitOurs(w);
    const head = git(w.ours, "rev-parse", "HEAD");
    expect(renumber(w.ours, ["origin/main"])).toEqual([]);
    expect(git(w.ours, "rev-parse", "HEAD")).toBe(head);
  });

  it("changes nothing when the same file is already upstream", () => {
    const w = world();
    commitOurs(w);
    git(w.ours, "push", "-q", "origin", "main");
    git(w.ours, "fetch", "-q", "origin", "main");
    const head = git(w.ours, "rev-parse", "HEAD");
    expect(renumber(w.ours, ["origin/main"])).toEqual([]);
    expect(git(w.ours, "rev-parse", "HEAD")).toBe(head);
  });
});

const run = (cwd: string, ...refs: string[]): string =>
  execFileSync(process.execPath, [SCRIPT, cwd, ...refs], {
    encoding: "utf8",
    stdio: "pipe",
  });

/** The exit status of the command, or "0" when it succeeds. */
const failure = (cwd: string, ...refs: string[]): string => {
  try {
    run(cwd, ...refs);
    return "0";
  } catch (error) {
    return error instanceof Error && "status" in error
      ? String(error.status)
      : "";
  }
};

describe("the command", () => {
  it("prints one JSON line on a clash and nothing otherwise", () => {
    const w = world();
    commitOurs(w);
    expect(run(w.ours, "origin/main")).toBe("");
    upstreamTakes(w);
    expect(run(w.ours, "origin/main")).toBe(
      '{"from":27,"to":28,"path":"rfcs/active/RFC-028-ours.md"}\n',
    );
  });

  it("exits 1 on a ref it cannot read", () => {
    const w = world();
    commitOurs(w);
    expect(failure(w.ours, "origin/nowhere")).toBe("1");
  });
});
