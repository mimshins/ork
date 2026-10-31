/**
 * @file Linking a project's tool folders to `.ork/`: `.claude/agents`,
 *   `.opencode/skills` and the rest become links to `.ork/agents` and
 *   `.ork/skills`, so every tool reads one origin, as se-backend's tools read
 *   `.ai/`. The tools' layouts come from the registry in integrations. Linking
 *   only creates: a real folder, or a link to somewhere else, is reported and
 *   kept, never replaced.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  type Stats,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  AGENT_TOOL_LAYOUTS,
  type AgentToolLayout,
  ORK_LAYOUT,
} from "@krapht/ork-integrations";

export const LINK_KINDS = ["agents", "skills"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** What is at a tool's folder now. */
export type LinkState =
  /** A link to `.ork/<kind>` (or the same folder by another path). */
  | "linked"
  /** Nothing: `ork link` can create it. */
  | "missing"
  /** A link whose target does not exist. */
  | "broken"
  /** A link to another folder, such as `.ai/agents`. */
  | "elsewhere"
  /** A real folder or file, which linking never replaces. */
  | "folder";

export type ToolLink = {
  tool: string;
  kind: LinkKind;
  /** Project-relative, e.g. `.claude/agents`. */
  path: string;
  /** Project-relative origin, e.g. `.ork/agents`. */
  origin: string;
  state: LinkState;
  /** Where a link points, as written in it (broken and elsewhere links). */
  target?: string;
};

/** A file that keeps an empty origin folder in git, so links never dangle. */
export const KEEP_FILE = ".gitkeep";

const layoutOf = (id: string): AgentToolLayout | undefined =>
  AGENT_TOOL_LAYOUTS.find(layout => layout.id === id);

const topOf = (layout: AgentToolLayout): string[] => [
  ...new Set(
    LINK_KINDS.flatMap(kind => {
      const folder = layout[kind];
      return folder === undefined ? [] : [folder.split("/")[0] ?? folder];
    }),
  ),
];

/** The tool ids `ork link` knows. */
export const linkableTools = (): string[] =>
  AGENT_TOOL_LAYOUTS.map(layout => layout.id);

/** The tools a project already uses: those whose top folder (`.claude`) exists. */
export const toolsInUse = (projectRoot: string): string[] =>
  AGENT_TOOL_LAYOUTS.filter(layout =>
    topOf(layout).some(top => existsSync(path.join(projectRoot, top))),
  ).map(layout => layout.id);

const realOrUndefined = (target: string): string | undefined => {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
};

const lstatOrUndefined = (target: string): Stats | undefined => {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
};

const stateOf = (
  root: string,
  relative: string,
  origin: string,
): { state: LinkState; target?: string } => {
  const at = path.join(root, relative);
  const stat = lstatOrUndefined(at);
  if (stat === undefined) return { state: "missing" };
  const real = realOrUndefined(at);
  const originReal = realOrUndefined(path.join(root, origin));
  if (real !== undefined && real === originReal) return { state: "linked" };
  if (!stat.isSymbolicLink()) return { state: "folder" };
  const target = readlinkSync(at);
  return real === undefined
    ? { state: "broken", target }
    : { state: "elsewhere", target };
};

/** Each folder of the named tools (all known tools by default), and its state. */
export const toolLinks = (
  projectRoot: string,
  tools: readonly string[] = linkableTools(),
): ToolLink[] =>
  tools.flatMap(id => {
    const layout = layoutOf(id);
    if (layout === undefined) return [];
    return LINK_KINDS.flatMap(kind => {
      const folder = layout[kind];
      if (folder === undefined) return [];
      const origin = ORK_LAYOUT[kind];
      return [
        {
          tool: id,
          kind,
          path: folder,
          origin,
          ...stateOf(projectRoot, folder, origin),
        },
      ];
    });
  });

export type LinkResult =
  | {
      ok: true;
      /** Every folder of the tools, after linking. */
      links: ToolLink[];
      /**
       * Project-relative paths created: links, and origins with their keep
       * file.
       */
      created: string[];
    }
  | { ok: false; error: string };

/** Creates `.ork/<kind>` if it is missing, with a keep file so git keeps it. */
const ensureOrigin = (root: string, origin: string, created: string[]) => {
  const dir = path.join(root, origin);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    created.push(origin);
  }
  if (readdirSync(dir).length === 0) {
    writeFileSync(path.join(dir, KEEP_FILE), "");
    created.push(`${origin}/${KEEP_FILE}`);
  }
};

/** A broken link to `.ork/<kind>` only needs the origin (a fresh clone). */
const pointsAtOrigin = (root: string, link: ToolLink): boolean =>
  link.target !== undefined &&
  path.resolve(path.dirname(path.join(root, link.path)), link.target) ===
    path.join(root, link.origin);

/**
 * Links the named tools' folders to `.ork/`. Only missing folders become links,
 * and a link to a missing origin gets its origin; the rest are left as they are
 * and reported in `links`.
 */
export const linkTools = (
  projectRoot: string,
  tools: readonly string[],
): LinkResult => {
  const unknown = tools.filter(id => layoutOf(id) === undefined);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown tool ${unknown.join(", ")}; known: ${linkableTools().join(", ")}.`,
    };
  }
  const created: string[] = [];
  for (const link of toolLinks(projectRoot, tools)) {
    if (link.state === "broken" && pointsAtOrigin(projectRoot, link)) {
      ensureOrigin(projectRoot, link.origin, created);
    }
    if (link.state !== "missing") continue;
    ensureOrigin(projectRoot, link.origin, created);
    const at = path.join(projectRoot, link.path);
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(
      path.relative(path.dirname(at), path.join(projectRoot, link.origin)),
      at,
      "dir",
    );
    created.push(link.path);
  }
  return { ok: true, links: toolLinks(projectRoot, tools), created };
};
