import { execFile } from "node:child_process";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when the status is not `ok`. */
  hint?: string;
};

export type ExecResult = { ok: boolean; stdout: string };

/** Runs a program without a shell. Never rejects. */
export type Exec = (
  program: string,
  args: readonly string[],
) => Promise<ExecResult>;

const TIMEOUT_MS = 15_000;

export const exec: Exec = (program, args) =>
  new Promise(resolve => {
    execFile(
      program,
      args,
      { timeout: TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        resolve({ ok: error === null, stdout });
      },
    );
  });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" && Object.hasOwn(value, key)
    ? (Reflect.get(value, key) as unknown)
    : undefined;

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

export const MIN_NODE = [24, 20] as const;

export const checkNode = (version: string): CheckResult => {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [minMajor, minMinor] = MIN_NODE;
  const ok = major > minMajor || (major === minMajor && minor >= minMinor);
  return ok
    ? { name: "node", status: "ok", detail: `v${version}` }
    : {
        name: "node",
        status: "fail",
        detail: `v${version}`,
        hint: `Ork needs Node ${MIN_NODE.join(".")} or later.`,
      };
};

export const checkGit = async (run: Exec): Promise<CheckResult[]> => {
  const version = await run("git", ["--version"]);
  if (!version.ok) {
    return [
      {
        name: "git",
        status: "fail",
        detail: "not found",
        hint: "Install git; Ork gives each writing node its own worktree.",
      },
    ];
  }
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"]);
  return [
    { name: "git", status: "ok", detail: firstLine(version.stdout) },
    inside.ok
      ? { name: "git repo", status: "ok", detail: "inside a work tree" }
      : {
          name: "git repo",
          status: "warn",
          detail: "not a git repository",
          hint: "Run Ork inside a git repository so nodes can use worktrees.",
        },
  ];
};

/** The Agent SDK driver: an API key or a cloud provider, from the environment. */
export const checkSdkDriver = (
  env: Readonly<Record<string, string | undefined>>,
): CheckResult => {
  const name = "claude (sdk driver)";
  if (env["CLAUDE_CODE_USE_BEDROCK"] === "1") {
    return { name, status: "ok", detail: "Amazon Bedrock" };
  }
  if (env["CLAUDE_CODE_USE_VERTEX"] === "1") {
    return { name, status: "ok", detail: "Google Vertex AI" };
  }
  if (env["CLAUDE_CODE_USE_FOUNDRY"] === "1") {
    return { name, status: "ok", detail: "Microsoft Foundry" };
  }
  if ((env["ANTHROPIC_API_KEY"] ?? "") !== "") {
    return { name, status: "ok", detail: "ANTHROPIC_API_KEY is set" };
  }
  return {
    name,
    status: "warn",
    detail: "no API key or cloud provider",
    hint: "Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1) to use the SDK driver.",
  };
};

/** The CLI driver: the user's own `claude`, logged in by the user. */
export const checkCliDriver = async (run: Exec): Promise<CheckResult> => {
  const name = "claude (cli driver)";
  const version = await run("claude", ["--version"]);
  if (!version.ok) {
    return {
      name,
      status: "warn",
      detail: "claude CLI not found",
      hint: "Install Claude Code to use the CLI driver.",
    };
  }
  const status = parseJson(
    (await run("claude", ["auth", "status", "--json"])).stdout,
  );
  if (field(status, "loggedIn") !== true) {
    return {
      name,
      status: "warn",
      detail: `${firstLine(version.stdout)}, not logged in`,
      hint: "Run `claude auth login` yourself; Ork never handles your login.",
    };
  }
  const method = field(status, "authMethod");
  const provider = field(status, "apiProvider");
  const via = [method, provider].filter(v => typeof v === "string").join(", ");
  return {
    name,
    status: "ok",
    detail: `${firstLine(version.stdout)}, logged in${via === "" ? "" : ` (${via})`}`,
  };
};

export const checkGh = async (run: Exec): Promise<CheckResult> => {
  const version = await run("gh", ["--version"]);
  if (!version.ok) {
    return {
      name: "gh",
      status: "skip",
      detail: "not installed (needed only for tool.gh nodes)",
    };
  }
  const status = parseJson(
    (await run("gh", ["auth", "status", "--json", "hosts"])).stdout,
  );
  const accounts = field(field(status, "hosts"), "github.com");
  const list: readonly unknown[] = Array.isArray(accounts) ? accounts : [];
  const active = list.find(a => field(a, "active") === true);
  const login = field(active, "login");
  if (field(active, "state") !== "success" || typeof login !== "string") {
    return {
      name: "gh",
      status: "warn",
      detail: "not logged in to github.com",
      hint: "Run `gh auth login` yourself to use tool.gh nodes.",
    };
  }
  return { name: "gh", status: "ok", detail: `logged in as ${login}` };
};

export const checkAws = async (
  run: Exec,
  env: Readonly<Record<string, string | undefined>>,
): Promise<CheckResult> => {
  const version = await run("aws", ["--version"]);
  if (!version.ok) {
    return {
      name: "aws",
      status: "skip",
      detail: "not installed (needed only for tool.aws nodes)",
    };
  }
  const profile = env["AWS_PROFILE"];
  const suffix = profile === undefined ? "" : ` (profile ${profile})`;
  const identity = await run("aws", [
    "sts",
    "get-caller-identity",
    "--output",
    "json",
  ]);
  return identity.ok
    ? { name: "aws", status: "ok", detail: `signed in${suffix}` }
    : {
        name: "aws",
        status: "warn",
        detail: `no valid credentials${suffix}`,
        hint: "Run `aws sso login` (or set AWS_PROFILE) yourself to use tool.aws nodes.",
      };
};

/**
 * Runs every check. Node, git, and at least one Claude driver are required; gh
 * and aws are optional.
 */
export const runChecks = async (
  run: Exec,
  env: Readonly<Record<string, string | undefined>>,
  nodeVersion: string,
): Promise<{ results: CheckResult[]; ok: boolean }> => {
  const [git, cli, gh, aws] = await Promise.all([
    checkGit(run),
    checkCliDriver(run),
    checkGh(run),
    checkAws(run, env),
  ]);
  const sdk = checkSdkDriver(env);
  const results = [checkNode(nodeVersion), ...git, sdk, cli, gh, aws];
  const anyDriver = sdk.status === "ok" || cli.status === "ok";
  const ok = anyDriver && !results.some(r => r.status === "fail");
  return { results, ok };
};
