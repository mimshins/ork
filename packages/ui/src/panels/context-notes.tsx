/**
 * @file What the Context panel says around a node's stack: in the header, that
 *   files changed after its run started (it may not be what the run loaded),
 *   that a spawned worker is planned as the node it came from, and that an ask
 *   failed; why a node has no context to show; the foot with the CLI command;
 *   and what it says with no node to show.
 */

import type { NodeContextAnswer } from "@krapht/ork-server/client";

import { EmptyState } from "../components/bits.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconAlert } from "../components/icons.tsx";
import { GlyphFailed } from "../components/status-glyphs.tsx";
import type { ContextTarget } from "../state/context-target.ts";
import { failedWords, sentence } from "./context-model.ts";

import styles from "./context.module.css";

const changedWords = (files: readonly string[]): string =>
  `Changed after this run started: ${files.map(f => `\`${f}\``).join(", ")}. The run may have read ${files.length === 1 ? "an older version" : "older versions"}.`;

export type HeaderNotesProps = {
  answer: NodeContextAnswer | null;
  error: string | null;
};

/**
 * The lines under the header's first: files changed since the run started, a
 * spawned worker, and a failed ask. Plain lines, each with its icon beside its
 * first line; the header's button tries a failed ask again. A failure is also
 * said through the workspace's live region, where the ask is made.
 */
export const HeaderNotes = ({ answer, error }: HeaderNotesProps) => {
  const changed = answer?.changedSinceStart ?? [];
  const planned = answer?.planned === true ? answer.explanation : null;
  return (
    <>
      {changed.length === 0 ? null : (
        <p
          className={styles["notice"]}
          data-note="changed"
        >
          <span className={styles["noticeIcon"]}>
            <IconAlert />
          </span>
          <span className={styles["noticeWords"]}>
            <CodeText text={changedWords(changed)} />
          </span>
        </p>
      )}
      {planned?.template === undefined ? null : (
        <p
          className={styles["notice"]}
          data-note="spawned"
        >
          <span className={styles["noticeWords"]}>
            <CodeText
              text={`\`${planned.node}\` was spawned during the run, so it's planned as \`${planned.template}\`, the node it was spawned from.`}
            />
          </span>
        </p>
      )}
      {error === null ? null : (
        <p
          className={styles["notice"]}
          data-note="failed"
        >
          <span className={styles["noticeIcon"]}>
            <GlyphFailed />
          </span>
          <span className={styles["noticeWords"]}>
            <CodeText text={failedWords(error, answer !== null)} />
          </span>
        </p>
      )}
    </>
  );
};

/** Why a node has no context to show, in the planner's words. */
export const NotPlanned = ({ why }: { why: string }) => (
  <div className={styles["card"]}>
    <p className={styles["cardTitle"]}>No context to show.</p>
    <p className={styles["description"]}>
      <CodeText text={sentence(why)} />
    </p>
  </div>
);

export const ContextFoot = ({
  cli,
  draft,
  sized,
}: {
  cli: string;
  draft: boolean;
  /** Whether sizes are shown, which the last line explains. */
  sized: boolean;
}) => (
  <footer className={styles["foot"]}>
    {draft ? (
      <p className={styles["description"]}>
        The CLI reads the saved file, not the draft.
      </p>
    ) : null}
    <CopyCommand command={cli} />
    {sized ? (
      <p className={styles["description"]}>
        Tokens are estimates, about four characters each.
      </p>
    ) : null}
  </footer>
);

/** What the panel says with no node to show. */
export const NoNode = ({ target }: { target: ContextTarget | null }) => {
  if (target?.kind === "run") {
    return (
      <EmptyState title="No node chosen in this run.">
        Choose one in the Monitor, Logs or Chats.
      </EmptyState>
    );
  }
  if (target?.kind === "builder") {
    return (
      <EmptyState title="No node selected in the Builder.">
        Select a card to see what its session loads.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="No node chosen.">
      Choose one in the Monitor or the Builder, or use{" "}
      <code>ork context explain &lt;workflow&gt; &lt;node&gt;</code>.
    </EmptyState>
  );
};
