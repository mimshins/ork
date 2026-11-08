/**
 * @file A decision's document: a "Read document" row (with its length) that
 *   opens the text in a dialog of its own, read-only, in one scroll region the
 *   keyboard can scroll. The card behind is unchanged, so an answer is one
 *   click once it is closed, and a document never stands between a person and
 *   the options.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { useRef, useState } from "react";

import { Button } from "../components/button.tsx";
import { Dialog, DialogActions } from "../components/dialog.tsx";
import { linesOf } from "../components/markdown-text.ts";
import { Markdown } from "../components/markdown.tsx";
import { codeLabeler, documentCommand } from "./decisions-model.ts";

import styles from "./decisions.module.css";

const lengthOf = (document: string): string => {
  const lines = linesOf(document);
  return lines === 1 ? "1 line" : `${lines} lines`;
};

export const DecisionDocument = ({
  decision,
  document,
}: {
  decision: DecisionRecord;
  document: string;
}) => {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const { id, node, runId } = decision;
  return (
    <div className={styles["read"]}>
      <Button
        cli={documentCommand(decision)}
        onClick={() => {
          setOpen(true);
        }}
        variant="ghost"
      >
        Read document
      </Button>
      <span className={styles["length"]}>{lengthOf(document)}</span>
      <Dialog
        description={`Document for run ${runId}. Read-only.`}
        initialFocus={region}
        onOpenChange={setOpen}
        open={open}
        size="wide"
        title={`\`${node}\` · \`${id}\``}
      >
        {/* The region is where the arrow, Page and Space keys scroll the text. */}
        <div
          aria-label="Document"
          className={styles["document"]}
          ref={region}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a named scroll region, not a landmark
          role="region"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region takes the focus so the keyboard can scroll it
          tabIndex={0}
        >
          <Markdown
            copyLabel={codeLabeler(`${node} document`)}
            startLevel={3}
            text={document}
          />
        </div>
        <DialogActions>
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};
