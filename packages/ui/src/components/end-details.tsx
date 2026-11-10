/**
 * @file The end's Details: the scrubbed raw text a provider or program gave,
 *   one click away and closed by default. It shows exactly as stored (plain
 *   text, no marks), from its start, since an error starts at the top; a copy
 *   button takes it. Without a detail there is no button.
 */

import { useId, useState } from "react";

import { Button } from "./button.tsx";
import { CopyButton } from "./copy-button.tsx";
import { IconChevronDown, IconChevronRight } from "./icons.tsx";
import { OutputWell } from "./output-well.tsx";

import styles from "./end-details.module.css";

export const EndDetails = ({
  node,
  detail,
  cli,
}: {
  node: string;
  /** The raw text; nothing is shown when there is none. */
  detail: string | undefined;
  /** The command that shows the same. */
  cli?: string | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const wellId = useId();
  if (detail === undefined) return null;
  return (
    <div className={styles["details"]}>
      <Button
        aria-controls={open ? wellId : undefined}
        aria-expanded={open}
        cli={cli}
        onClick={() => {
          setOpen(shown => !shown);
        }}
        variant="ghost"
      >
        {open ? <IconChevronDown /> : <IconChevronRight />}
        Details
      </Button>
      {open ? (
        <div
          className={styles["open"]}
          id={wellId}
        >
          <div className={styles["bar"]}>
            <span className={styles["caption"]}>Scrubbed. At most 4 KiB.</span>
            <span className={styles["copy"]}>
              <CopyButton
                label="Copy details"
                text={detail}
              />
            </span>
          </div>
          <OutputWell
            follow={false}
            label={`Raw details of ${node}`}
            text={detail}
          />
        </div>
      ) : null}
    </div>
  );
};
