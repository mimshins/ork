/**
 * @file Tests renumbering the ADRs and gap ids a change adds against a fetched
 *   upstream: the pure line and plan functions, and the tool on real
 *   repositories with a bare remote.
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

import { orderAdrRows, planAdrs, renumberAdrLine } from "../adrs.ts";
import { bumpNextIds, definitionsOf, planGapIds } from "../gap-ids.ts";
import { renumber } from "../renumber.ts";

const SCRIPT = fileURLToPath(new URL("../renumber.ts", import.meta.url));

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

const row = (
  number: string,
  slug: string,
  title: string,
  status = "Accepted",
) => `| [${number}](./ADR-${number}-${slug}.md) | ${title} | ${status} |`;

const adr = (number: string, title: string, extra = ""): string =>
  `# ADR-${number} — ${title}\n\n- **Status:** Accepted\n${extra}\nSee ADR-${number} and ADR-0${number}.\n`;

const INDEX_HEAD = [
  "# Decisions",
  "",
  "| ADR | Title | Status |",
  "| --- | --- | --- |",
  row("105", "five", "Five"),
  row("106", "six", "Six"),
].join("\n");

const register = (next: string, entries: string[]): string =>
  `# Known gaps and limits\n\nIds are never reused: the next limit is ${next}, and the next chore is C19.\n\n${entries.join("\n")}\n`;

type World = { ours: string; upstream: string };

/** A bare remote at main, a clone that holds our change, and one for upstream. */
const world = (): World => {
  const base = mkdtempSync(path.join(tmpdir(), "ork-adr-renumber-"));
  made.push(base);
  const remote = path.join(base, "remote.git");
  const seed = path.join(base, "seed");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["clone", "-q", remote, seed], { stdio: "pipe" });
  identify(seed);
  git(seed, "checkout", "-q", "-b", "main");
  put(seed, "decisions/README.md", `${INDEX_HEAD}\n`);
  put(seed, "decisions/ADR-105-five.md", adr("105", "Five"));
  put(seed, "decisions/ADR-106-six.md", adr("106", "Six"));
  put(seed, "specs/gaps.md", register("L524", ["- **L522 · Old.** Text."]));
  put(seed, "specs/gaps/area.md", "# Area\n\n- **L523 · Older.** Text.\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "base");
  git(seed, "push", "-q", "origin", "main");
  const ours = path.join(base, "ours");
  const upstream = path.join(base, "upstream");
  for (const clone of [ours, upstream]) {
    execFileSync("git", ["clone", "-q", remote, clone], { stdio: "pipe" });
    identify(clone);
  }
  return { ours, upstream };
};

/** Commits `files` (path to text, appended to the index when it is a row). */
const commit = (
  root: string,
  files: Record<string, string>,
  rows: string[] = [],
  message = "Change\n\nbody",
): void => {
  for (const [file, text] of Object.entries(files)) {
    put(root, file, text);
  }
  const index = read(root, "decisions/README.md").trimEnd();
  put(root, "decisions/README.md", `${[index, ...rows].join("\n")}\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
};

/** Upstream publishes `files` and `rows` to main; ours fetches it. */
const upstreamPublishes = (
  w: World,
  files: Record<string, string>,
  rows: string[] = [],
): void => {
  commit(w.upstream, files, rows, "theirs");
  git(w.upstream, "push", "-q", "origin", "main");
  git(w.ours, "fetch", "-q", "origin", "main");
};

const upstreamTakesAdr = (w: World): void => {
  upstreamPublishes(
    w,
    { "decisions/ADR-107-theirs.md": adr("107", "Theirs") },
    [row("107", "theirs", "Theirs")],
  );
};

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("renumberAdrLine", () => {
  const moves = planAdrs(
    [
      { path: "decisions/ADR-107-a.md", file: "ADR-107-a.md", number: 107 },
      { path: "decisions/ADR-108-b.md", file: "ADR-108-b.md", number: 108 },
    ],
    [{ ref: "origin/main", taken: new Map([[107, ["ADR-107-x.md"]]]) }],
    new Map(),
  );
  const bare = (from: number): number | undefined =>
    moves.find(move => move.number === from)?.to;

  it("rewrites links, labels and bare mentions in one pass", () => {
    expect(
      renumberAdrLine(
        "[ADR-107](./ADR-107-a.md), ADR-108, ADR-1070 and [ADR-107](./ADR-107-x.md)",
        moves,
        bare,
      ),
    ).toBe(
      "[ADR-108](./ADR-108-a.md), ADR-109, ADR-1070 and [ADR-107](./ADR-107-x.md)",
    );
  });

  it("rewrites an index row and its amended-by number", () => {
    expect(
      renumberAdrLine(
        "| [107](./ADR-107-a.md) | A | Amended by 108 |",
        moves,
        bare,
        true,
      ),
    ).toBe("| [108](./ADR-108-a.md) | A | Amended by 109 |");
  });

  it("leaves a bare mention alone when it may stand for another ADR", () => {
    const none = new Map<number, number>();
    expect(renumberAdrLine("See ADR-107.", moves, n => none.get(n))).toBe(
      "See ADR-107.",
    );
  });
});

describe("orderAdrRows", () => {
  it("sorts the rows by number and pads the table", () => {
    const out = orderAdrRows(
      `${INDEX_HEAD}\n${row("108", "b", "Bee")}\n${row("107", "a", "A")}\n`,
    ).split("\n");
    expect(out.slice(4).map(line => line.slice(0, 7))).toEqual([
      "| [105]",
      "| [106]",
      "| [107]",
      "| [108]",
      "",
    ]);
    expect(new Set(out.slice(2, 8).map(line => line.length)).size).toBe(1);
  });
});

describe("planGapIds", () => {
  it("moves an id a ref's next-id line has passed", () => {
    const moves = planGapIds(
      definitionsOf(["- **L524 · Ours.**"]),
      [{ ref: "origin/main", defs: new Map(), next: new Map([["L", 526]]) }],
      [],
    );
    expect(moves.map(move => [move.id, move.to])).toEqual([["L524", "L526"]]);
  });

  it("keeps an id a ref defines with the same entry", () => {
    const line = "- **L524 · Ours.**";
    const moves = planGapIds(
      definitionsOf([line]),
      [
        {
          ref: "origin/main",
          defs: new Map([["L524", [line]]]),
          next: new Map([["L", 525]]),
        },
      ],
      [],
    );
    expect(moves).toEqual([]);
  });
});

describe("bumpNextIds", () => {
  it("raises a letter's next id and never lowers one", () => {
    expect(
      bumpNextIds(
        "the next limit is L524, and the next chore is C19",
        new Map([
          ["L", 530],
          ["C", 3],
        ]),
      ),
    ).toBe("the next limit is L530, and the next chore is C19");
  });
});

describe("renumber", () => {
  it("moves an added ADR whose number upstream took", () => {
    const w = world();
    commit(
      w.ours,
      {
        "decisions/ADR-107-ours.md": adr("107", "Ours"),
        "specs/a.md":
          "See [ADR-107](../decisions/ADR-107-ours.md) and ADR-107.\n",
      },
      [row("107", "ours", "Ours")],
    );
    const base = git(w.ours, "rev-parse", "HEAD~1");
    upstreamTakesAdr(w);
    expect(renumber(w.ours, ["origin/main"])).toEqual([
      {
        kind: "adr",
        from: 107,
        to: 108,
        path: "decisions/ADR-108-ours.md",
        reason: "ADR-107 is taken on origin/main",
      },
    ]);
    expect(git(w.ours, "rev-parse", "HEAD~1")).toBe(base);
    expect(git(w.ours, "log", "-1", "--format=%B")).toBe("Change\n\nbody");
    expect(git(w.ours, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(w.ours, "decisions/ADR-107-ours.md"))).toBe(
      false,
    );
    expect(read(w.ours, "decisions/ADR-108-ours.md")).toContain(
      "# ADR-108 — Ours\n\n- **Status:** Accepted\n\nSee ADR-108 and ADR-0107.",
    );
    expect(read(w.ours, "specs/a.md")).toBe(
      "See [ADR-108](../decisions/ADR-108-ours.md) and ADR-108.\n",
    );
    expect(read(w.ours, "decisions/README.md")).toMatch(
      /\| \[108\]\(\.\/ADR-108-ours\.md\) \| Ours +\| Accepted \|\n$/u,
    );
  });

  it("gives two added ADRs consecutive numbers and keeps the rows in order", () => {
    const w = world();
    commit(
      w.ours,
      {
        "decisions/ADR-107-ours.md": adr(
          "107",
          "Ours",
          "\nAmended by ADR-108.\n",
        ),
        "decisions/ADR-108-second.md": adr("108", "Second"),
      },
      [
        row("108", "second", "Second"),
        row("107", "ours", "Ours", "Amended by 108"),
      ],
    );
    upstreamTakesAdr(w);
    const done = renumber(w.ours, ["origin/main"]);
    expect(done.map(d => [d.from, d.to])).toEqual([
      [107, 108],
      [108, 109],
    ]);
    expect(read(w.ours, "decisions/ADR-108-ours.md")).toContain(
      "Amended by ADR-109.",
    );
    expect(read(w.ours, "decisions/ADR-109-second.md")).toContain(
      "# ADR-109 —",
    );
    const rows = read(w.ours, "decisions/README.md").split("\n").slice(4, 8);
    expect(rows.map(line => line.split("|")[1]?.trim())).toEqual([
      "[105](./ADR-105-five.md)",
      "[106](./ADR-106-six.md)",
      "[108](./ADR-108-ours.md)",
      "[109](./ADR-109-second.md)",
    ]);
    expect(rows[2]).toContain("Amended by 109");
  });

  it("moves an added limit id upstream took and raises the next-id line", () => {
    const w = world();
    put(w.ours, "specs/gaps.md", register("L526", ["- **L522 · Old.** Text."]));
    commit(w.ours, {
      "specs/gaps/new.md":
        "# New\n\n- **L524 · First.** Text.\n- **L525 · Second.** Like L524.\n",
      "specs/b.md": "See L524 and L525, not L5240.\n",
    });
    upstreamPublishes(w, {
      "specs/gaps.md": register("L525", ["- **L522 · Old.** Text."]),
      "specs/gaps/theirs.md": "# Theirs\n\n- **L524 · Theirs.** Text.\n",
    });
    const done = renumber(w.ours, ["origin/main"]);
    expect(done.map(d => [d.kind, d.from, d.to])).toEqual([
      ["gap", "L524", "L525"],
      ["gap", "L525", "L526"],
    ]);
    expect(read(w.ours, "specs/gaps/new.md")).toBe(
      "# New\n\n- **L525 · First.** Text.\n- **L526 · Second.** Like L525.\n",
    );
    expect(read(w.ours, "specs/b.md")).toBe("See L525 and L526, not L5240.\n");
    expect(read(w.ours, "specs/gaps.md")).toContain(
      "the next limit is L527, and the next chore is C19.",
    );
    expect(read(w.ours, "specs/gaps/area.md")).toContain("- **L523 · Older.**");
    expect(git(w.ours, "status", "--porcelain")).toBe("");
  });

  it("changes nothing when no number clashes", () => {
    const w = world();
    commit(
      w.ours,
      {
        "decisions/ADR-107-ours.md": adr("107", "Ours"),
        "specs/gaps/new.md": "# New\n\n- **L524 · First.** Text.\n",
      },
      [row("107", "ours", "Ours")],
    );
    const head = git(w.ours, "rev-parse", "HEAD");
    expect(renumber(w.ours, ["origin/main"])).toEqual([]);
    expect(git(w.ours, "rev-parse", "HEAD")).toBe(head);
  });

  it("changes nothing when the same ADR is already upstream", () => {
    const w = world();
    commit(w.ours, { "decisions/ADR-107-ours.md": adr("107", "Ours") }, [
      row("107", "ours", "Ours"),
    ]);
    git(w.ours, "push", "-q", "origin", "main");
    git(w.ours, "fetch", "-q", "origin", "main");
    expect(renumber(w.ours, ["origin/main"])).toEqual([]);
  });

  it("keeps an existing ADR the change edits and rewrites only what it adds", () => {
    const w = world();
    const six = read(w.ours, "decisions/ADR-106-six.md");
    const index = read(w.ours, "decisions/README.md").replace(
      row("106", "six", "Six"),
      row("106", "six", "Six", "Amended by 107"),
    );
    put(w.ours, "decisions/README.md", index);
    commit(
      w.ours,
      {
        "decisions/ADR-106-six.md": `${six}\nAmended by [ADR-107](./ADR-107-ours.md).\n`,
        "decisions/ADR-107-ours.md": adr("107", "Ours"),
      },
      [row("107", "ours", "Ours")],
    );
    upstreamTakesAdr(w);
    expect(renumber(w.ours, ["origin/main"]).map(d => d.to)).toEqual([108]);
    expect(read(w.ours, "decisions/ADR-106-six.md")).toBe(
      `${six}\nAmended by [ADR-108](./ADR-108-ours.md).\n`,
    );
    expect(read(w.ours, "decisions/ADR-105-five.md")).toBe(adr("105", "Five"));
    expect(read(w.ours, "decisions/README.md")).toMatch(
      /\[106\]\(\.\/ADR-106-six\.md\) +\| Six +\| Amended by 108 \|/u,
    );
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
  it("prints one JSON line per move and nothing otherwise", () => {
    const w = world();
    commit(w.ours, { "decisions/ADR-107-ours.md": adr("107", "Ours") }, [
      row("107", "ours", "Ours"),
    ]);
    expect(run(w.ours, "origin/main")).toBe("");
    upstreamTakesAdr(w);
    expect(run(w.ours, "origin/main")).toBe(
      '{"kind":"adr","from":107,"to":108,"path":"decisions/ADR-108-ours.md"}\n',
    );
  });

  it("exits 1 on a ref it cannot read", () => {
    const w = world();
    commit(w.ours, { "decisions/ADR-107-ours.md": adr("107", "Ours") });
    expect(failure(w.ours, "origin/nowhere")).toBe("1");
  });
});
