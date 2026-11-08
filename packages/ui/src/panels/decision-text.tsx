/**
 * @file What a decision asks, as it reads: the question as Markdown with its
 *   top-level paragraphs strong, and the context muted; each folds past about
 *   20 lines. A permission's context is the tool's command or path as written,
 *   one code block with a copy button, not Markdown. The question's first line,
 *   as plain words, is a hidden element the card's name reads, so a screen
 *   reader hears what it asks and not the whole text.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { CopyCommand } from "../components/copy-command.tsx";
import { FoldedText } from "../components/folded-text.tsx";
import { firstLineOf } from "../components/markdown-text.ts";
import { Markdown } from "../components/markdown.tsx";
import { codeLabeler, isJsonContext } from "./decisions-model.ts";

export const DecisionText = ({
  decision: { kind, node, question, context },
  nameId,
}: {
  decision: DecisionRecord;
  /** The id of the hidden first line, for the card's `aria-labelledby`. */
  nameId: string;
}) => (
  <>
    <span
      hidden
      id={nameId}
    >
      {firstLineOf(question)}
    </span>
    <FoldedText source={question}>
      <Markdown
        copyLabel={codeLabeler(node)}
        lead
        startLevel={4}
        text={question}
      />
    </FoldedText>
    {context === undefined ? null : kind === "permission" ? (
      <CopyCommand
        caption={isJsonContext(context) ? "json" : undefined}
        command={context}
        label={`Copy command (${node})`}
      />
    ) : (
      <FoldedText source={context}>
        <Markdown
          copyLabel={codeLabeler(node)}
          muted
          startLevel={4}
          text={context}
        />
      </FoldedText>
    )}
  </>
);
