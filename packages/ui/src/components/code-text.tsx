/**
 * @file Words that name values: what's between backticks shows as inline code,
 *   so an id, a field or a command reads apart from the sentence around it. The
 *   engine's messages and the UI's own copy mark values this way. Where text
 *   can't hold markup, such as what a screen reader is told, `plainWords` gives
 *   the same words without the marks.
 */

export type CodePart = { code: boolean; text: string };

/** The same number of backticks either side, as Markdown pairs them. */
const CODE_RUN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/gu;

/** What's in a code run: a space either side is what lets it hold a backtick. */
const codeInside = (text: string): string =>
  text.startsWith(" ") && text.endsWith(" ") ? text.slice(1, -1) : text;

/**
 * A text's plain and code runs, in order. A backtick with no partner stays as
 * it is, and so does a pair with nothing in it.
 */
export const codeParts = (text: string): CodePart[] => {
  const parts: CodePart[] = [];
  let plain = "";
  let at = 0;
  for (const match of text.matchAll(CODE_RUN)) {
    const inside = match[2] ?? "";
    if (inside.trim() !== "") {
      plain += text.slice(at, match.index);
      if (plain !== "") parts.push({ code: false, text: plain });
      plain = "";
      parts.push({ code: true, text: codeInside(inside) });
      at = match.index + match[0].length;
    }
  }
  plain += text.slice(at);
  return plain === "" ? parts : [...parts, { code: false, text: plain }];
};

/** The same words, for where markup can't go. */
export const plainWords = (text: string): string =>
  codeParts(text)
    .map(part => part.text)
    .join("");

export const CodeText = ({ text }: { text: string }) =>
  codeParts(text).map(({ code, text: words }, index) =>
    code ? (
      // The runs of a message never reorder, so their place is who they are.
      // oxlint-disable-next-line react/no-array-index-key
      <code key={index}>{words}</code>
    ) : (
      words
    ),
  );
