/**
 * @file The `omp` guard (RFC-026): the extension Ork writes in a session's
 *   private folder and loads with `--trusted-extension`, the fence that holds
 *   an `omp` session to its node's tool rules and holds a paused node's next
 *   call. Its `tool_call` handler, for each call: maps the name to Ork's words
 *   (`bash` is `Bash`, `mcp__ork_session_ork_<tool>` is `mcp__ork__<tool>`) and
 *   refuses one Ork does not know; refuses everything once the session's
 *   `stopped` marker exists; refuses an address with a scheme, a path in Ork's
 *   private folder, and an `edit` or `write` whose real path is outside the
 *   worktree or that names no path it can read, `--yolo` included (`omp` has no
 *   sandbox); applies the node's rules and the reading rule with the shared
 *   matcher (`tools/tool-rules-source.ts`); then, when the session can be held,
 *   asks Ork's hold endpoint (`hold.json`: its URL and the bearer token) and
 *   waits for the answer. Its `tool_result` handler frees a `heavy` slot after
 *   a `Bash` call that was asked. Anything going wrong refuses the call.
 */

import {
  type ToolRuleSet,
  toolRulesSource,
} from "../tools/tool-rules-source.ts";
import { toolId } from "../tools/tool.ts";
import { OMP_ORK_PREFIX, OMP_TOOLS } from "./omp-names.ts";

/** The guard's file in the session's private folder. */
export const OMP_GUARD_FILE = "guard.mjs";

/** The hold endpoint's file beside the guard: an {@link OmpHoldFile}, 0600. */
export const OMP_HOLD_FILE = "hold.json";

/**
 * The marker beside the guard that the session was stopped: every call is
 * refused.
 */
export const OMP_STOPPED_FILE = "stopped";

/** What `hold.json` holds. */
export type OmpHoldFile = { url: string; token: string };

/** The hold endpoint's answer the guard reads as "the node is still paused". */
export const HELD: Readonly<Record<string, string>> = { ork: "held" };

/** The refusal of a call a paused node made, once the hold window ran out. */
export const OMP_PAUSED =
  "Ork paused this node, so this call did not run. Make the same call again; it waits until the node continues. Do nothing else.";

/** Where the guard's own files are. */
export type GuardFiles = {
  /** The session's private folder: the guard's files, and no tool's path. */
  dir: string;
  /** Whether the guard asks Ork's hold endpoint, from `hold.json` in `dir`. */
  hold: boolean;
};

/**
 * The guard's source: plain JavaScript that `omp` loads (a default export
 * taking the extension API), carrying its own matcher. It holds no secret: the
 * token is read from `hold.json` when it loads, and a `hold.json` it expects
 * and cannot read makes it throw, which stops the leg.
 */
export const guardSource = (
  rules: ToolRuleSet,
  files: GuardFiles,
): string => `// Ork's guard for one omp session; written by Ork, removed after it.
${toolRulesSource(rules, {
  tools: OMP_TOOLS,
  reads: ["read", "grep", "glob"],
  meta: [],
  // A rule's word, as omp's tools read it, covers these of Ork's tool names.
  covers: { read: ["Read", "Glob", "Grep"], edit: ["Edit", "Write"] },
})}import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
const DIR = ${JSON.stringify(files.dir)};
const SECRET = real(DIR);
const STOPPED = resolve(DIR, ${JSON.stringify(OMP_STOPPED_FILE)});
const HOLD = ${String(files.hold)} ? JSON.parse(readFileSync(resolve(DIR, ${JSON.stringify(OMP_HOLD_FILE)}), "utf8")) : undefined;
if (HOLD !== undefined && (typeof HOLD?.url !== "string" || typeof HOLD?.token !== "string")) {
  throw new Error(${JSON.stringify(`${OMP_HOLD_FILE} names no hold URL and token`)});
}
const HELD = ${JSON.stringify(JSON.stringify(HELD))};
const PAUSED = ${JSON.stringify(OMP_PAUSED)};
const STOPPED_WORDS = "Ork stopped this node, so this call did not run. Do nothing else.";
const ORK_PREFIX = ${JSON.stringify(OMP_ORK_PREFIX)};
const ORK_TOOL = ${JSON.stringify(toolId(""))};
// A tool's name in Ork's words; undefined for one Ork does not know.
const orkName = name => Object.hasOwn(TOOLS, name)
  ? TOOLS[name]
  : name.startsWith(ORK_PREFIX) && name.length > ORK_PREFIX.length ? ORK_TOOL + name.slice(ORK_PREFIX.length) : undefined;
const SCHEME = new RegExp("^[a-z][a-z0-9+.-]*://", "i");
const within = (at, root) => {
  const from = relative(root, at);
  return from === "" || (from !== ".." && !from.startsWith("../") && !isAbsolute(from));
};
const where = each => real(resolve(RULES.cwd, each === "~" || each.startsWith("~/") ? homedir() + each.slice(1) : each));
// A [path#TAG] header line's path (omp's hashline form); undefined for another line.
const headerPath = line => {
  const text = line.trim();
  if (text.length < 3 || !text.startsWith("[") || !text.endsWith("]")) return undefined;
  const inner = text.slice(1, -1);
  const at = inner.lastIndexOf("#");
  const path = at < 0 ? inner : inner.slice(0, at);
  return path === "" ? undefined : path;
};
// An edit's files: its input opens with a header. A later line in the header's
// form with a tag counts as one more file; at worst that refuses more.
const editPaths = text => {
  const lines = text.split("\\n");
  const first = headerPath(lines[0]);
  if (first === undefined) return null;
  const more = lines.slice(1).filter(line => line.includes("#")).map(headerPath).filter(each => each !== undefined);
  return [first, ...more];
};
// Where a search looks: a glob's folders before its first wildcard.
const globBase = pattern => {
  const parts = pattern.split("/");
  const at = parts.findIndex(part => /[*?[{]/.test(part));
  const base = (at < 0 ? parts : parts.slice(0, at)).join("/");
  return base !== "" ? base : pattern.startsWith("/") ? "/" : ".";
};
// The paths a file tool names; null when it names none Ork can read.
const named = (name, input) => {
  const path = input?.path;
  if (name === "edit") return typeof input?.input === "string" ? editPaths(input.input) : null;
  if (name === "grep" || name === "glob") return path === undefined ? ["."] : typeof path === "string" ? [path] : null;
  if (name === "read" || name === "write") return typeof path === "string" ? [path] : null;
  return [];
};
// What no rule and no --yolo lets a file tool do.
const fence = (name, input) => {
  const paths = named(name, input);
  if (paths === null) return "refused when it names no path Ork can read";
  if (paths.some(each => SCHEME.test(each))) return "refused for an address with a scheme";
  const searches = name === "grep" || name === "glob";
  const places = paths.map(each => where(searches ? globBase(each) : each));
  // A search over a folder that holds Ork's private folder would read its token.
  if (places.some(at => within(at, SECRET) || (searches && within(SECRET, at)))) return "refused on Ork's private folder";
  if ((name === "edit" || name === "write") && !places.every(at => within(at, ROOT))) return "refused outside the worktree";
  return undefined;
};
const refuse = reason => ({ block: true, reason });
const refusal = (name, why) => refuse("Ork: " + name + " is " + why + ". Do not retry it.");
const unasked = (name, why) => refuse("Ork: " + name + " did not run, Ork could not be asked (" + why + ").");
// Asks Ork's hold endpoint, with no timeout of its own: a paused node waits.
const ask = body => new Promise((done, fail) => {
  const req = request(HOLD.url, {
    method: "POST",
    headers: { authorization: "Bearer " + HOLD.token, "content-type": "application/json" },
  }, res => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", chunk => { text += chunk; });
    res.on("error", fail);
    res.on("end", () => {
      if (res.statusCode !== 200) fail(new Error("status " + String(res.statusCode)));
      else {
        try { done(JSON.parse(text)); } catch (error) { fail(error); }
      }
    });
  });
  req.on("error", fail);
  req.end(JSON.stringify(body));
});
// The Bash calls the hold endpoint let run: their slot is freed after them.
const ASKED = new Set();
const before = async event => {
  const name = String(event?.toolName ?? "");
  const ork = orkName(name);
  if (ork === undefined) return refusal(name, "not a tool Ork knows");
  if (existsSync(STOPPED)) return refuse(STOPPED_WORDS);
  const input = event.input ?? {};
  const fenced = fence(name, input);
  if (fenced !== undefined) return refusal(name, fenced);
  const why = decide(Object.hasOwn(TOOLS, name) ? name : ork, input);
  if (typeof why === "object") return refuse(why.read);
  if (why !== undefined) return refusal(name, why);
  if (HOLD === undefined) return undefined;
  let answer;
  try {
    answer = JSON.stringify(await ask({ hook_event_name: "PreToolUse", tool_name: ork, tool_input: input }));
  } catch (error) {
    return unasked(name, String(error?.message ?? error));
  }
  // A stop while the call was held: whatever the answer, it does not run.
  if (existsSync(STOPPED)) return refuse(STOPPED_WORDS);
  if (answer === HELD) return refuse(PAUSED);
  if (answer !== "{}") return unasked(name, "an answer it does not know");
  if (ork === "Bash") ASKED.add(event.toolCallId);
  return undefined;
};
// After a call: frees its heavy slot; a failure leaves it to the next call or the end.
const after = async event => {
  if (HOLD === undefined || !ASKED.delete(event?.toolCallId)) return undefined;
  try {
    await ask({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: event.input ?? {} });
  } catch {
    // The hold endpoint frees the slot at the session's next call or its end.
  }
  return undefined;
};
export default pi => {
  pi.on("tool_call", async event => {
    try {
      return await before(event);
    } catch (error) {
      return refuse("Ork: the call is refused, its rules could not be checked (" + String(error?.message ?? error) + ").");
    }
  });
  pi.on("tool_result", after);
};
`;
