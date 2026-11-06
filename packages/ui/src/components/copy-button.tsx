/**
 * @file The copy button: an icon button that copies some text, and a status
 *   that says whether it did. The status is an `<output>`, so a screen reader
 *   hears it too, and its words are new each time, so copying again is heard.
 */

import { useState } from "react";

import { IconButton } from "./button.tsx";
import { IconCopy } from "./icons.tsx";

type Result = "" | "Copied." | "Copy failed: select the text instead.";

export type CopyButtonProps = {
  /** What it copies. */
  text: string;
  /** What it does, in words: "Copy ork ps". */
  label: string;
  /** The status's class, for where it sits. */
  resultClass?: string | undefined;
};

export const CopyButton = ({ text, label, resultClass }: CopyButtonProps) => {
  const [result, setResult] = useState<{ words: Result; count: number }>({
    words: "",
    count: 0,
  });
  const say = (words: Result): void => {
    setResult(({ count }) => ({ words, count: count + 1 }));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      say("Copied.");
    } catch {
      say("Copy failed: select the text instead.");
    }
  };
  return (
    <>
      <IconButton
        label={label}
        onClick={() => {
          void copy();
        }}
      >
        <IconCopy />
      </IconButton>
      <output className={resultClass}>
        <span key={result.count}>{result.words}</span>
      </output>
    </>
  );
};
