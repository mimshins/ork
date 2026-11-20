/**
 * @file Tests for a permission prompt's scopes (RFC-028): the options a shell
 *   line with rules gets, the rules a node or the run remembers from an answer
 *   (also in a new process on the same store, as after a resume), only those
 *   the chosen option named, and "always" handing its rules on, with a warning
 *   and the run's allow when that fails.
 */

import { describe, expect, it } from "vitest";

import {
  createDecisionQueue,
  type DecisionChoice,
  type DecisionQueueOptions,
  type EventStore,
  type HumanChannel,
  openStore,
  permissionVerdict,
} from "../src/index.ts";

type Permit = Awaited<ReturnType<HumanChannel["permit"]>>;

/** A terminal that gives `result` to every prompt, and the options it saw. */
const terminal = (result: Permit) => {
  const seen: (readonly DecisionChoice[] | undefined)[] = [];
  const human: HumanChannel = {
    ask: () => Promise.resolve(""),
    permit: request => {
      seen.push(request.options);
      return Promise.resolve(result);
    },
  };
  return { human, seen };
};

const newStore = (): EventStore => {
  const store = openStore(":memory:");
  store.begin({ id: "r1", workflow: "w", file: "/w", project: "/p" });
  return store;
};

/** A queue for run `r1` on `store`: the process of the run, or of its resume. */
const queueOn = (
  store: EventStore,
  local: HumanChannel,
  extra: Partial<DecisionQueueOptions> = {},
): HumanChannel =>
  createDecisionQueue({
    store,
    runId: "r1",
    local,
    emit: () => {
      // These tests read the store, not the events.
    },
    waitFor: () =>
      new Promise(() => {
        // Only the terminal answers here.
      }),
    ...extra,
  });

const bash = (nodeId: string, command: string, rules?: string[]) => ({
  nodeId,
  toolName: "Bash",
  input: { command },
  ...(rules === undefined ? {} : { rules }),
});

const LOG = ["Bash(git log *)"];

const opened = (store: EventStore): number =>
  store.decisions({ runId: "r1" }).length;

describe("a permission prompt's options", () => {
  it("offers only allow and deny without rules", async () => {
    const { human, seen } = terminal({ allow: true });
    const store = newStore();
    await queueOn(store, human, { rulesFile: "/p/.ork/project.yaml" }).permit(
      bash("n", "git log"),
    );
    expect(store.decision("r1-1")?.options.map(o => o.id)).toEqual([
      "allow",
      "deny",
    ]);
    expect(seen[0]?.map(o => o.id)).toEqual(["allow", "deny"]);
  });

  it("offers node, run and always with the rules and the file shown", async () => {
    const { human, seen } = terminal({ allow: true });
    const store = newStore();
    await queueOn(store, human, { rulesFile: "/p/.ork/project.yaml" }).permit(
      bash("n", "git log -p", LOG),
    );
    const options = store.decision("r1-1")?.options;
    expect(options?.map(o => o.id)).toEqual([
      "allow",
      "allow-node",
      "allow-run",
      "allow-always",
      "deny",
    ]);
    expect(options?.[1]?.description).toContain("`Bash(git log *)`");
    expect(options?.[3]?.description).toContain(
      "`Bash(git log *)` to permissions.allow in /p/.ork/project.yaml",
    );
    expect(seen[0]).toEqual(options);
  });

  it("offers no always when the rules file is unknown", async () => {
    const { human } = terminal({ allow: true, scope: "always" });
    const store = newStore();
    expect(
      await queueOn(store, human).permit(bash("n", "git log", LOG)),
    ).toEqual({ allow: true });
    expect(store.decision("r1-1")?.options.map(o => o.id)).not.toContain(
      "allow-always",
    );
    expect(store.decision("r1-1")?.answer).toBe("allow");
  });
});

describe("remembered rules", () => {
  it("allow a node's later calls they cover, and only that node's", async () => {
    const { human } = terminal({ allow: true, scope: "node" });
    const store = newStore();
    const queue = queueOn(store, human);
    expect(await queue.permit(bash("a", "git log -p", LOG))).toEqual({
      allow: true,
      scope: "node",
    });
    expect(store.decision("r1-1")?.answer).toBe("allow-node");
    // `git -C x log` gives the same rule, so it is covered.
    await queue.permit(bash("a", "git -C x log", LOG));
    expect(opened(store)).toBe(1);
    await queue.permit(bash("b", "git log", LOG));
    expect(opened(store)).toBe(2);
    await queue.permit(bash("a", "git diff", ["Bash(git diff *)"]));
    expect(opened(store)).toBe(3);
  });

  it("allow every node's calls for the run, also after a resume", async () => {
    const store = newStore();
    await queueOn(store, terminal({ allow: true, scope: "run" }).human).permit(
      bash("a", "git log", LOG),
    );
    const { human, seen } = terminal({ allow: false, message: "no" });
    const resumed = queueOn(store, human);
    expect(await resumed.permit(bash("b", "git log -p", LOG))).toEqual({
      allow: true,
    });
    expect(seen).toEqual([]);
    expect(opened(store)).toBe(1);
  });

  it("are only those the chosen option named", async () => {
    const store = newStore();
    // The node's own rules covered `git log --oneline`: only diff was shown.
    await queueOn(store, terminal({ allow: true, scope: "run" }).human).permit(
      bash("a", "git log --oneline && git diff HEAD", ["Bash(git diff *)"]),
    );
    const queue = queueOn(store, terminal({ allow: true }).human);
    await queue.permit(bash("a", "git diff x", ["Bash(git diff *)"]));
    expect(opened(store)).toBe(1);
    await queue.permit(bash("a", "git log -p", LOG));
    expect(opened(store)).toBe(2);
  });

  it("are not kept from a plain allow or a deny", async () => {
    const store = newStore();
    await queueOn(store, terminal({ allow: true }).human).permit(
      bash("a", "git log", LOG),
    );
    await queueOn(
      store,
      terminal({ allow: false, message: "no" }).human,
    ).permit(bash("a", "git log", LOG));
    await queueOn(store, terminal({ allow: true }).human).permit(
      bash("a", "git log", LOG),
    );
    expect(opened(store)).toBe(3);
  });
});

describe("an always answer", () => {
  it("hands its rules on and allows them for the run", async () => {
    const written: string[][] = [];
    const store = newStore();
    const queue = queueOn(
      store,
      terminal({ allow: true, scope: "always" }).human,
      {
        rulesFile: "/p/.ork/project.yaml",
        rememberAlways: rules => {
          written.push(rules);
        },
      },
    );
    expect(await queue.permit(bash("a", "git log", LOG))).toEqual({
      allow: true,
      scope: "always",
    });
    expect(written).toEqual([LOG]);
    await queue.permit(bash("b", "git log -p", LOG));
    expect(opened(store)).toBe(1);
  });

  it("still allows for the run when the write fails, and warns", async () => {
    const warnings: string[] = [];
    const store = newStore();
    const queue = queueOn(
      store,
      terminal({ allow: true, scope: "always" }).human,
      {
        rulesFile: "/p/.ork/project.yaml",
        rememberAlways: () => Promise.reject(new Error("read-only file")),
        warn: text => {
          warnings.push(text);
        },
      },
    );
    expect(await queue.permit(bash("a", "git log", LOG))).toEqual({
      allow: true,
      scope: "always",
    });
    expect(warnings).toEqual([
      "Ork could not add Bash(git log *) to /p/.ork/project.yaml (read-only file); they are allowed for the rest of this run.",
    ]);
    await queue.permit(bash("b", "git log", LOG));
    expect(opened(store)).toBe(1);
  });
});

/** A queue with no terminal: `decide` (here, a function) answers each decision. */
const answeredBy = (
  store: EventStore,
  answer: string,
  extra: Partial<DecisionQueueOptions> = {},
): HumanChannel =>
  createDecisionQueue({
    store,
    runId: "r1",
    emit: () => {
      // These tests read the store, not the events.
    },
    waitFor: id => {
      store.answerDecision(id, answer, "decide");
      const record = store.decision(id);
      return record === undefined
        ? Promise.reject(new Error(`no decision ${id}`))
        : Promise.resolve(record);
    },
    ...extra,
  });

describe("a scope answered from the store, with no terminal", () => {
  it("allow-run carries its scope and covers a later call of any node", async () => {
    const store = newStore();
    const queue = answeredBy(store, "allow-run");
    expect(await queue.permit(bash("a", "git log", LOG))).toEqual({
      allow: true,
      scope: "run",
    });
    expect(await queue.permit(bash("b", "git log -p", LOG))).toEqual({
      allow: true,
    });
    expect(opened(store)).toBe(1);
  });

  it("allow-always carries its scope, hands its rules on and covers a later call", async () => {
    const written: string[][] = [];
    const store = newStore();
    const queue = answeredBy(store, "allow-always", {
      rulesFile: "/p/.ork/project.yaml",
      rememberAlways: rules => {
        written.push(rules);
      },
    });
    expect(await queue.permit(bash("a", "git log", LOG))).toEqual({
      allow: true,
      scope: "always",
    });
    expect(written).toEqual([LOG]);
    expect(await queue.permit(bash("a", "git log -p", LOG))).toEqual({
      allow: true,
    });
    expect(opened(store)).toBe(1);
    expect(written).toEqual([LOG]);
  });

  it("allow-node covers node a's later calls, and node b still asks", async () => {
    const store = newStore();
    const queue = answeredBy(store, "allow-node");
    await queue.permit(bash("a", "git log", LOG));
    await queue.permit(bash("a", "git log -p", LOG));
    expect(opened(store)).toBe(1);
    await queue.permit(bash("b", "git log", LOG));
    expect(opened(store)).toBe(2);
  });
});

describe("a remembered rule and a deny rule", () => {
  it("is allowed by the queue, but the verdict, which runs first, denies it", async () => {
    const store = newStore();
    const queue = answeredBy(store, "allow-run");
    await queue.permit(bash("a", "git log", LOG));
    const line = "git log -p";
    // The queue alone would allow the call from memory ...
    expect(await queue.permit(bash("a", line, LOG))).toEqual({ allow: true });
    expect(opened(store)).toBe(1);
    // ... so the `permission` tool asks the verdict first, and a deny rule ends it.
    expect(
      permissionVerdict(line, { allow: [], deny: ["Bash(git *)"] }),
    ).toEqual({ verdict: "deny", message: "denied for this node" });
  });
});

describe("a yolo run", () => {
  it("records allow and deny only, and remembers nothing", async () => {
    const store = newStore();
    const queue = queueOn(
      store,
      terminal({ allow: false, message: "no" }).human,
      {
        yolo: true,
      },
    );
    expect(await queue.permit(bash("a", "git log", LOG))).toEqual({
      allow: true,
    });
    expect(store.decision("r1-1")?.options.map(o => o.id)).toEqual([
      "allow",
      "deny",
    ]);
  });
});
