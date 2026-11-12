/**
 * @file What a person can do with a follow-up in the Follow-ups panel: the
 *   buttons its status allows, each with the CLI it stands for. The one that
 *   finishes the work is primary only when the item is due. Whether each is
 *   enabled, and why not, is the server's answer; a disabled button stays
 *   focusable and says why in its name and tooltip. Nothing is optimistic.
 */

import type { FollowUpActions } from "@krapht/ork-server/client";

import { Button } from "../components/button.tsx";
import { type Act, actsFor, labelOf } from "./followups-acts.ts";
import { type FollowUpRow, short } from "./followups-model.ts";

import styles from "./followups.module.css";

export const Actions = ({
  row,
  actions,
  onAct,
}: {
  row: FollowUpRow;
  actions: FollowUpActions | undefined;
  onAct: (key: Act["key"]) => void;
}) => (
  <div
    aria-label={`Actions on ${short(row.id)}`}
    className={styles["actions"]}
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset is for form fields, and these are actions
    role="group"
  >
    {actsFor(row, actions).map(({ key, word, cli, variant, check }) => (
      <Button
        aria-label={labelOf(word, check)}
        cli={cli}
        disabled={!check.ok}
        focusableWhenDisabled
        key={key}
        onClick={() => {
          onAct(key);
        }}
        tip={check.ok ? undefined : check.why}
        variant={variant}
      >
        {word}
      </Button>
    ))}
  </div>
);
