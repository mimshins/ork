/**
 * @file Words that name values: what's between backticks shows as inline code,
 *   so an id, a field or a command reads apart from the sentence around it. The
 *   engine's messages and the UI's own copy mark values this way. Where text
 *   can't hold markup, such as what a screen reader is told, `plainWords` gives
 *   the same words without the marks.
 */

export type CodePart = { code: boolean; text: string };

/** A text's plain and code runs, in order. A lone backtick stays as it is. */
export const codeParts = (text: string): CodePart[] =>
  text
    .split(/`([^`\n]+)`/u)
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter(part => part.text !== "");

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
