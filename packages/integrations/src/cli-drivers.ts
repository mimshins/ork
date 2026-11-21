/**
 * @file The drivers Ork finds by `<program> --version` (`open-code`,
 *   `command-code`, `codex`, `codex-app-server`, `omp`): one shared doctor
 *   check, the version comparison it uses, and each driver's descriptor.
 *   `drivers.ts` registers them. Ork never handles the user's login (ADR-004).
 */

import type { AgentDriver, DriverId } from "./drivers.ts";
import type { Exec } from "./integration.ts";
import { firstLine } from "./json.ts";
import { ompModels, ompSelectors } from "./omp-models.ts";

/**
 * The first OpenCode found to honour a server's `codemode: false`, so Ork's
 * tools reach the model as tools (2.1.0 hid them behind Code Mode).
 */
export const MIN_OPENCODE_VERSION = "2.3.2";

/** The first Codex that has every flag Ork passes to `codex exec` (RFC-024). */
export const MIN_CODEX_VERSION = "0.169.0";

/**
 * The `omp` the capture legs of RFC-026 ran: the first with every flag and line
 * shape the driver relies on.
 */
export const MIN_OMP_VERSION = "18.22.2";

/** Whether `claude --version` output names a version below `min`. */
export const olderThan = (text: string, min: string): boolean => {
  const found = /(\d+)\.(\d+)\.(\d+)/u.exec(text);
  if (found === null) return false;
  const have = found.slice(1).map(Number);
  const want = min.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
};

/**
 * A driver whose tool Ork finds by `<program> --version`. While `proven` is
 * false its check is `skip`, never `ok`, so `readyDriver` never takes it and
 * `ork doctor` does not count it as a ready driver. Its login is the tool's own
 * and never its credential files (ADR-004), so the detail only names the
 * command to run, or what the tool's own check printed.
 */
const installedCli = (
  id: DriverId,
  program: string,
  login: string,
  {
    min,
    loginStatus,
    loginOutput,
    ...rest
  }: Pick<
    AgentDriver,
    "label" | "capabilities" | "proven" | "onePerCheckout" | "models"
  > & {
    /** The oldest version Ork works with, and why: older is a warning. */
    min?: { version: string; why: string };
    /**
     * The tool's own login check, run after the version check: only its exit
     * status is read, never its output or the credential files (ADR-004).
     */
    loginStatus?: string[];
    /**
     * A login check whose output is read, for a tool with no status command:
     * `read` gives the detail's words (`logged in (12 models)`), or `null` for
     * not signed in. A command that fails is not signed in. The output must
     * carry no secret; the credential files are never read (ADR-004).
     */
    loginOutput?: { args: string[]; read: (stdout: string) => string | null };
  },
): AgentDriver => ({
  id,
  ...rest,
  doctor: async exec => {
    const name = `${program} (${id} driver)`;
    const version = await exec(program, ["--version"]);
    const unproven = rest.proven
      ? ""
      : ", unproven: not yet proven on a real session";
    // Another driver is optional: a missing tool is a skip, not a warning.
    if (!version.ok) {
      return {
        name,
        status: "skip",
        detail: `${program} CLI not found${unproven}`,
        // No hint while unproven: it would show under "no driver is ready".
        ...(rest.proven
          ? { hint: `Install ${program} to use the ${id} driver.` }
          : {}),
      };
    }
    if (min !== undefined && olderThan(version.stdout, min.version)) {
      return {
        name,
        status: "warn",
        detail: `${firstLine(version.stdout)}, older than ${min.version}`,
        hint: min.why,
      };
    }
    const signedIn = await loginWords(exec, program, loginStatus, loginOutput);
    if (signedIn === null) {
      return {
        name,
        status: rest.proven ? "warn" : "skip",
        detail: `${firstLine(version.stdout)}, not logged in${unproven}; sign in with \`${login}\``,
        // No hint while unproven, as for a missing tool.
        ...(rest.proven ? { hint: `Sign in with \`${login}\`.` } : {}),
      };
    }
    return {
      name,
      status: rest.proven ? "ok" : "skip",
      detail:
        signedIn === undefined
          ? `${firstLine(version.stdout)}${unproven}; sign in with \`${login}\` if a session asks`
          : `${firstLine(version.stdout)}, ${signedIn}${unproven}`,
    };
  },
});

/**
 * What a driver's login check says: the detail's words, `null` for not signed
 * in, or `undefined` when the driver has no check.
 */
const loginWords = async (
  exec: Exec,
  program: string,
  status: string[] | undefined,
  output:
    | { args: string[]; read: (stdout: string) => string | null }
    | undefined,
): Promise<string | null | undefined> => {
  if (status !== undefined) {
    return (await exec(program, status)).ok ? "logged in" : null;
  }
  if (output === undefined) return undefined;
  const found = await exec(program, output.args);
  return found.ok ? output.read(found.stdout) : null;
};

export const openCode = installedCli(
  "open-code",
  "opencode",
  "opencode auth login",
  {
    label: "the `opencode` CLI",
    proven: true,
    min: {
      version: MIN_OPENCODE_VERSION,
      why: "Update OpenCode (`opencode upgrade`): an older one ignores Ork's `codemode: false`, so Ork's tools never reach the model.",
    },
    onePerCheckout: false,
    // Proven on a real session (2026-11-10): Ork's tools reach the model with
    // Code Mode off, and the agent's `steps` caps the turns.
    capabilities: {
      questions: true,
      permissionPrompt: false,
      price: true,
      midTurnMessages: false,
      reportSchema: false,
      turnLimit: true,
      mcpServers: true,
      // Not measured on a real session yet: refused until it is.
      subagents: false,
      readDenies: true,
    },
  },
);

export const commandCode = installedCli("command-code", "cmd", "cmd login", {
  label: "the `cmd` CLI of Command Code",
  proven: true,
  onePerCheckout: true,
  capabilities: {
    questions: true,
    permissionPrompt: false,
    price: false,
    midTurnMessages: false,
    reportSchema: false,
    turnLimit: true,
    // Its MCP servers come from a per-folder scope, which holds only Ork's.
    mcpServers: false,
    subagents: false,
    readDenies: true,
  },
});

// RFC-024. Proven on a real session (2026-11-18, codex-cli 0.169.0): Ork's
// tools reach the model, the hook refuses, and a resumed leg keeps both.
export const codex = installedCli("codex", "codex", "codex login", {
  label: "the `codex` CLI of OpenAI",
  proven: true,
  onePerCheckout: false,
  min: {
    version: MIN_CODEX_VERSION,
    why: "Update Codex: an older one lacks flags Ork passes to `codex exec`.",
  },
  // Only its exit status: 0 is logged in. Ork never reads `auth.json`.
  loginStatus: ["login", "status"],
  capabilities: {
    questions: true,
    permissionPrompt: false,
    price: false,
    midTurnMessages: false,
    // The API's strict mode refuses Ork's report schemas (optional fields, an
    // `artifacts` map) under `--output-schema`: reports use the `report` tool.
    reportSchema: false,
    turnLimit: false,
    // Codex reads no `.mcp.json`: a node's own servers would need Ork to
    // write them as `-c mcp_servers.*` keys.
    mcpServers: false,
    subagents: false,
    // No read tool for the hook to gate, and the sandbox may read outside the
    // worktree: a path-scoped read deny cannot hold (RFC-024).
    readDenies: false,
  },
});

// RFC-027, option A: `codex app-server` (JSON-RPC over stdio) beside `codex
// exec`, under its own id. Not yet proven: no run takes it until a capped gate
// run passes.
export const codexAppServer = installedCli(
  "codex-app-server",
  "codex",
  "codex login",
  {
    label: "the `codex app-server` of OpenAI's `codex` CLI",
    proven: false,
    onePerCheckout: false,
    min: {
      version: MIN_CODEX_VERSION,
      why: "Update Codex: an older one lacks flags Ork passes to `codex app-server`.",
    },
    // Only its exit status: 0 is logged in. Ork never reads `auth.json`.
    loginStatus: ["login", "status"],
    capabilities: {
      questions: true,
      // Command and file-change approvals arrive as requests Ork answers.
      permissionPrompt: true,
      price: false,
      // A `turn/steer` request: read before the turn ends, not at once; a
      // running command may finish first.
      midTurnMessages: true,
      reportSchema: false,
      turnLimit: false,
      mcpServers: false,
      subagents: false,
      readDenies: false,
    },
  },
);

/**
 * RFC-026's descriptor, proven or not: the doctor check reads `proven` when it
 * is made, so a test of the proven check needs its own copy.
 */
export const ompDriver = (proven: boolean): AgentDriver =>
  installedCli("omp", "omp", "omp login", {
    label: "the `omp` CLI of oh-my-pi",
    proven,
    onePerCheckout: false,
    min: {
      version: MIN_OMP_VERSION,
      why: "Update omp: an older one may lack flags and line shapes Ork relies on.",
    },
    // `omp` has no status command: the models its logins reach, only counted.
    loginOutput: { args: ["models", "--json"], read: ompModels },
    models: async exec => {
      const listed = await exec("omp", ["models", "--json"]);
      return listed.ok ? ompSelectors(listed.stdout) : null;
    },
    capabilities: {
      questions: true,
      // `omp --mode rpc` asks Ork about a tool missing from the approval map.
      permissionPrompt: true,
      price: true,
      // A `steer` frame, read before the turn ends (RFC-027).
      midTurnMessages: true,
      reportSchema: false,
      turnLimit: false,
      mcpServers: false,
      subagents: false,
      // Held by `--tools`: a path-scoped read deny offers none of the read tools.
      readDenies: true,
    },
  });

// Proven on the 2026-11-21 gate run (omp 18.22.2): specs/runtime/omp-gate.md.
export const omp = ompDriver(true);
