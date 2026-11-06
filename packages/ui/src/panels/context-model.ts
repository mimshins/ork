/**
 * @file What the Context panel shows of a node's explanation, without React:
 *   its six sections in `ork context explain`'s order, each piece with what it
 *   is, where it comes from, whether it's live and its size, and the words a
 *   screen reader hears for it; the sections' sums; and the CLI command that
 *   prints the same.
 */

import type { Explanation } from "@krapht/ork-server/client";

export type Piece = {
  /** Stable across a re-ask: section, layer and name. */
  key: string;
  name: string;
  state?: "live" | "off";
  layer?: string;
  source?: string;
  tokens?: number;
  /** Why an off piece is off, as the planner says it. */
  why?: string;
  /** Its words; a piece without them (a skipped practice) can't be opened. */
  text?: string;
  /** Where its words come from, for the bar above them. */
  place?: string;
};

export type Section = {
  id: string;
  title: string;
  meta: string;
  description?: string;
  /** Said when the section has no pieces. */
  empty: string;
  pieces: Piece[];
};

const count = (n: number): string => n.toLocaleString("en");

/** A size as the panel shows it: `≈1,204`. */
export const approx = (tokens: number): string => `≈${count(tokens)}`;

/**
 * The planner's words as a sentence, as written: a full stop last, and a
 * capital first only on a plain word, so a setting such as `project.skills:
 * ignore` keeps its name.
 */
export const sentence = (words: string): string => {
  const trimmed = words.trim();
  const capital = /^[a-z]+\s/u.test(trimmed)
    ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
    : trimmed;
  return capital === "" || /[.!?…]$/u.test(capital) ? capital : `${capital}.`;
};

const sum = (pieces: readonly { tokens?: number }[]): number =>
  pieces.reduce((total, piece) => total + (piece.tokens ?? 0), 0);

const states = (pieces: readonly Piece[]): string => {
  const live = pieces.filter(p => p.state === "live").length;
  const off = pieces.length - live;
  return off === 0
    ? `${count(live)} live`
    : `${count(live)} live, ${count(off)} off`;
};

/** A section's count and size, in the words that say what's counted. */
const listMeta = (
  pieces: readonly Piece[],
  what: (n: number) => string,
  off = 0,
): string => {
  const shown = `${what(pieces.length)} · ${approx(sum(pieces))}`;
  return off === 0 ? shown : `${shown}, ${count(off)} off`;
};

const fileCount = (n: number): string =>
  `${count(n)} ${n === 1 ? "file" : "files"}`;
const liveCount = (n: number): string => `${count(n)} live`;

/** The six sections of an explanation, in the CLI's order. */
export const sectionsOf = (e: Explanation): Section[] => {
  const agent: Piece[] =
    e.agent === undefined
      ? []
      : [
          {
            key: `agent/${e.agent.name}`,
            name: e.agent.name,
            source: e.agent.where,
            tokens: e.agent.tokens,
            text: e.agent.text ?? "",
            place: e.agent.where,
          },
        ];
  const instructions: Piece[] = (e.instructionFiles ?? []).map(f => ({
    key: `instructions/${f.name}`,
    name: f.name,
    tokens: f.tokens,
    text: f.text,
    place: f.name,
  }));
  const skills: Piece[] = e.skills.map(s => ({
    key: `skill/${s.layer}/${s.name}`,
    name: s.name,
    state: s.state,
    layer: s.layer,
    source: s.source,
    tokens: s.tokens,
    ...(s.why === undefined ? {} : { why: s.why }),
    text: s.text ?? "",
    place: s.source === "built-in" ? "built-in" : `${s.source}/SKILL.md`,
  }));
  // The same file can be listed twice at a layer, so its place is in its key.
  const files: Piece[] = e.files.map((f, index) => ({
    key: `file/${f.layer}/${f.name}/${String(index)}`,
    name: f.name,
    layer: f.layer,
    tokens: f.tokens,
    text: f.text ?? "",
    place: f.name,
  }));
  const practices: Piece[] = [
    ...e.practices.map(p => ({
      key: `practice/${p.name}`,
      name: p.name,
      state: "live" as const,
      tokens: p.tokens,
      text: p.text ?? "",
      place: `practice: ${p.name}`,
    })),
    ...e.skippedPractices.map(name => ({
      key: `practice/${name}`,
      name,
      state: "off" as const,
      why: "The project's own skill wins.",
    })),
  ];
  return [
    {
      id: "agent",
      title: "Agent",
      meta: approx(sum(agent)),
      empty: "No agent fills this node.",
      pieces: agent,
    },
    {
      id: "instructions",
      title: "Project instructions",
      meta: approx(sum(instructions)),
      description: "Claude Code reads these itself; they aren't appended.",
      empty: sentence(e.instructions),
      pieces: instructions,
    },
    {
      id: "skills",
      title: "Skills",
      meta: skills.length === 0 ? "none" : states(skills),
      description: "A skill's SKILL.md loads only when the session uses it.",
      empty: "No skills.",
      pieces: skills,
    },
    {
      id: "files",
      title: "Context files",
      meta: listMeta(files, fileCount),
      empty: "No context files.",
      pieces: files,
    },
    {
      id: "practices",
      title: "Practices",
      meta: listMeta(
        practices.filter(p => p.state === "live"),
        liveCount,
        e.skippedPractices.length,
      ),
      empty: "No practices.",
      pieces: practices,
    },
    {
      id: "appended",
      title: "Appended system prompt",
      meta: approx(e.appendedTokens),
      description:
        "Everything Ork adds to Claude Code's system prompt, in the order the session reads it: the agent's role, the context files and practices above, Ork's own instructions to the node, and the node's `instructions`.",
      empty: "Nothing is appended.",
      pieces: [
        {
          key: "appended",
          name: "The whole prompt",
          tokens: e.appendedTokens,
          text: e.appended ?? "",
          place: "system prompt, appended",
        },
      ],
    },
  ];
};

/**
 * A failed ask in a sentence: with nothing shown yet, or beside the last
 * answer.
 */
export const failedWords = (error: string, answered: boolean): string =>
  answered
    ? `Couldn't update: ${sentence(error)} This is the answer from before.`
    : `Couldn't read the context: ${sentence(error)}`;

/** How many lines a text has, for the bar above it. */
export const linesOf = (text: string): number =>
  text === "" ? 0 : text.replace(/\n$/u, "").split("\n").length;

/** A path as it's typed from the project's root: inside it, relative. */
export const fromRoot = (file: string, root: string): string => {
  const base = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(base) ? file.slice(base.length) : file;
};

/** `ork context explain` for the same node. */
export const cliTwin = (workflow: string, node: string): string =>
  `ork context explain ${workflow} ${node}`;
