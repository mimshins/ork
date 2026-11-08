/**
 * @file Markdown as a view: untrusted decision text (a question, a context, a
 *   document) drawn as elements from the parser's tree by Ork's own renderer,
 *   so no HTML string exists and nothing in the text can be an element. The
 *   subset: headings, paragraphs (a newline is a line break, as gate text is
 *   written in lines), lists, emphasis, inline code, code blocks with a copy
 *   button, quotes, rules and links. Only `http:`, `https:` and `mailto:` are
 *   links; any other target shows as text with the target beside it, an image
 *   as its alt text, and raw HTML as its own source. A text that fails to
 *   render shows as written, with a note
 *   (specs/ui/panels-decisions-readable.md).
 */

import type { Nodes, Parents, PhrasingContent, RootContent } from "mdast";
import { Fragment, type ReactNode } from "react";

import { CopyCommand } from "./copy-command.tsx";
import {
  countBlocks,
  FLOW_PARENTS,
  isAllowedLink,
  parseMarkdown,
  plainOf,
} from "./markdown-text.ts";
import { Unseen } from "./unseen.tsx";

import styles from "./markdown.module.css";

export type MarkdownProps = {
  text: string;
  /** The level a `#` heading takes: 4 in a card (its heading is an `h3`). */
  startLevel: 3 | 4;
  /** Top-level paragraphs in the strong weight: a question's. */
  lead?: boolean;
  /** In the muted text color: a question's context. */
  muted?: boolean;
  /** Names the copy buttons apart from another text's on the page. */
  copyLabel?: ((index: number, total: number) => string) | undefined;
};

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

type Draw = {
  startLevel: number;
  blocks: number;
  next: () => number;
  copyLabel: (index: number, total: number) => string;
};

const codeLabel = (index: number, total: number): string =>
  total === 1 ? "Copy code" : `Copy code block ${index} of ${total}`;

/** A node's place in its source: unique among its siblings, so a stable key. */
const keyOf = (node: Nodes): string => String(node.position?.start.offset);

/** Text with a `<br>` at each newline; a line's key is where it starts. */
const lines = (value: string, from: string): ReactNode[] => {
  let offset = 0;
  return value.split("\n").flatMap((line, row) => {
    const here = `${from}:${offset}`;
    offset += line.length + 1;
    return row === 0 ? [line] : [<br key={here} />, line];
  });
};

const inline = (nodes: readonly PhrasingContent[]): ReactNode =>
  nodes.map(node => <Fragment key={keyOf(node)}>{phrase(node)}</Fragment>);

const phrase = (node: PhrasingContent): ReactNode => {
  if (node.type === "text") return lines(node.value, keyOf(node));
  if (node.type === "emphasis") return <em>{inline(node.children)}</em>;
  if (node.type === "strong") return <strong>{inline(node.children)}</strong>;
  if (node.type === "delete" || node.type === "linkReference") {
    return inline(node.children);
  }
  if (node.type === "inlineCode") {
    return <code className={styles["inline"]}>{node.value}</code>;
  }
  if (node.type === "break") return <br />;
  if (node.type === "html") return node.value;
  if (node.type === "link") return link(node.url, node.children);
  if (node.type === "image" || node.type === "imageReference") {
    return (
      <span className={styles["image"]}>
        {node.alt === undefined || node.alt === null || node.alt === ""
          ? "image"
          : `image: ${node.alt}`}
      </span>
    );
  }
  return null;
};

/** An allowed link, or the words and where they pointed, as text. */
const link = (url: string, children: readonly PhrasingContent[]): ReactNode => {
  if (isAllowedLink(url)) {
    return (
      <a
        className={styles["link"]}
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {inline(children)}
        <Unseen> (opens in a new tab)</Unseen>
      </a>
    );
  }
  const words = children.map(child => plainOf(child)).join("");
  return words === url || words === "" ? (
    <code className={styles["target"]}>{url}</code>
  ) : (
    <>
      {inline(children)} (<code className={styles["target"]}>{url}</code>)
    </>
  );
};

const block = (node: RootContent, parent: Parents, draw: Draw): ReactNode => {
  const key = keyOf(node);
  if (node.type === "paragraph")
    return <p key={key}>{inline(node.children)}</p>;
  if (node.type === "heading") {
    const Tag =
      HEADINGS[Math.min(6, draw.startLevel + node.depth - 1) - 1] ?? "h6";
    return <Tag key={key}>{inline(node.children)}</Tag>;
  }
  if (node.type === "thematicBreak") return <hr key={key} />;
  if (node.type === "blockquote") {
    return <blockquote key={key}>{blocks(node, draw)}</blockquote>;
  }
  if (node.type === "list") {
    const items = node.children.map(item => (
      <li key={keyOf(item)}>{blocks(item, draw)}</li>
    ));
    return node.ordered === true ? (
      <ol
        key={key}
        start={node.start ?? 1}
      >
        {items}
      </ol>
    ) : (
      <ul key={key}>{items}</ul>
    );
  }
  if (node.type === "definition") {
    // A reference link's target: shown, so a path never vanishes.
    return (
      <p key={key}>
        [{node.label ?? node.identifier}]:{" "}
        <code className={styles["target"]}>{node.url}</code>
      </p>
    );
  }
  if (node.type === "code") return code(node.value, node.lang, draw, key);
  if (node.type !== "html") return null;
  return FLOW_PARENTS.includes(parent.type) ? (
    code(node.value, undefined, draw, key)
  ) : (
    <Fragment key={key}>{node.value}</Fragment>
  );
};

const code = (
  value: string,
  lang: string | null | undefined,
  draw: Draw,
  key: string,
): ReactNode => (
  <CopyCommand
    caption={lang ?? undefined}
    command={value}
    key={key}
    label={draw.copyLabel(draw.next(), draw.blocks)}
  />
);

const blocks = (parent: Parents, draw: Draw): ReactNode =>
  parent.children.map(node => block(node, parent, draw));

/** Text as it was written, for when it could not be drawn. */
const asWritten = (text: string): ReactNode => (
  <>
    <p className={styles["note"]}>
      Could not render this as Markdown: showing the text as written.
    </p>
    <pre className={styles["written"]}>{text}</pre>
  </>
);

export const Markdown = ({
  text,
  startLevel,
  lead = false,
  muted = false,
  copyLabel = codeLabel,
}: MarkdownProps) => {
  let drawn: ReactNode;
  try {
    const tree = parseMarkdown(text);
    let count = 0;
    drawn = blocks(tree, {
      startLevel,
      blocks: countBlocks(tree),
      next: () => ++count,
      copyLabel,
    });
  } catch {
    drawn = asWritten(text);
  }
  return (
    <div
      className={styles["markdown"]}
      data-lead={lead ? "" : undefined}
      data-muted={muted ? "" : undefined}
    >
      {drawn}
    </div>
  );
};
