/**
 * @file What the publish dialog shows: where the post goes, then its title and
 *   its text in a sunken well, as characters, never rendered as Markdown, since
 *   a person approves exactly what goes; and once it went, where it is. The
 *   well with the text is a region the keys can scroll, where the focus starts;
 *   a text from the read before says so in words. A failure has its line kept
 *   for it, so it never moves what has the focus.
 */

import type { PublishPreview } from "@krapht/ork-server/client";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { IconExternal } from "../components/icons.tsx";
import { Unseen } from "../components/unseen.tsx";

import styles from "./feedback.module.css";

/** A link that opens in a new tab, and says so. */
export const ThreadLink = ({ url }: { url: string }) => (
  <a
    className={styles["link"]}
    href={url}
    rel="noreferrer"
    target="_blank"
  >
    {url}
    <IconExternal />
    <Unseen> (opens in a new tab)</Unseen>
  </a>
);

export const WhereLine = ({ preview }: { preview: PublishPreview }) =>
  preview.plan.kind === "create" ? (
    <p className={styles["message"]}>
      <CodeText
        text={`A new thread in the Agent feedback category of \`${preview.repo}\`.`}
      />
    </p>
  ) : (
    <p className={styles["message"]}>
      A thread for this exists, so this goes on it as a +1 comment:{" "}
      <ThreadLink url={preview.plan.url} />
    </p>
  );

const READING = "Reading Ork's Discussions with your `gh`…";

const NONE = "Nothing to show: the preview couldn't be read.";

/**
 * The title and the text to post. While a preview is read again (names hidden
 * or shown), or after that read failed, the one before stays in view, dimmed,
 * so nothing jumps; Post waits for the new one.
 */
/** Says, beside a well's caption, that its text isn't the latest read. */
const StaleNote = ({ id }: { id?: string }) => (
  <span
    className={styles["note"]}
    id={id}
  >
    From the last read
  </span>
);

export const PreviewWells = ({
  preview,
  reading,
  region,
  stale,
  staleId,
}: {
  preview: PublishPreview | undefined;
  reading: boolean;
  /** The text's well, where the focus starts. */
  region: RefObject<HTMLElement | null>;
  /** The preview in view isn't what would be sent now. */
  stale: boolean;
  /** The id of the words that say so, which the text's well points at. */
  staleId: string;
}) => {
  const creating = preview?.plan.kind !== "comment";
  const text =
    preview === undefined
      ? ""
      : creating
        ? preview.post.body
        : preview.post.comment;
  const caption = creating ? "Body" : "Comment";
  // Said in words as well as dimmed, which forced colors would erase.
  const old = stale && preview !== undefined;
  return (
    <>
      {preview === undefined || !creating ? null : (
        <>
          <div className={styles["line"]}>
            <p className={styles["caption"]}>Title</p>
            {old ? <StaleNote /> : null}
          </div>
          <p
            className={styles["preview"]}
            data-stale={stale ? "" : undefined}
          >
            {preview.post.title}
          </p>
        </>
      )}
      <div className={styles["wellHead"]}>
        <div className={styles["line"]}>
          <p className={styles["caption"]}>{caption}</p>
          {old ? <StaleNote id={staleId} /> : null}
        </div>
        {text === "" ? null : (
          // One child, so the row puts it at the end, its status with it.
          <span className={styles["wellCopy"]}>
            <CopyButton
              label={`Copy the ${caption.toLowerCase()}`}
              text={text}
            />
          </span>
        )}
      </div>
      <section
        aria-busy={reading}
        aria-describedby={old ? staleId : undefined}
        aria-label="Text to post"
        className={styles["preview"]}
        data-scrolls=""
        data-stale={stale ? "" : undefined}
        ref={region}
        // Focusable, so the keys scroll it, and the first thing read.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keys must reach
        tabIndex={0}
      >
        {text === "" ? <CodeText text={reading ? READING : NONE} /> : text}
      </section>
      <p className={styles["note"]}>
        {
          "This is the Markdown that is sent, as it is. Secrets, your projects' paths, your home folder, emails, host names and IP addresses are taken out."
        }
      </p>
    </>
  );
};

export const PublishFoot = ({ children }: { children: ReactNode }) => (
  <div className={styles["dialogFoot"]}>
    <p className={styles["note"]}>
      <CodeText text="It posts with your own `gh` login." />
    </p>
    <div className={styles["actions"]}>{children}</div>
  </div>
);

export const HideNamesHint = ({ id }: { id: string }) => (
  <p
    className={styles["note"]}
    id={id}
  >
    <CodeText text="Your workflows' and projects' folders' names become `<name>`." />
  </p>
);

/** Where the post went; its heading takes the focus. */
export const Posted = ({
  id,
  url,
  kind,
  onClose,
}: {
  id: string;
  url: string;
  kind: "created" | "commented";
  onClose: () => void;
}) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <>
      <h3
        className={styles["result"]}
        ref={heading}
        tabIndex={-1}
      >
        {kind === "created" ? "Posted" : "Added a +1"}
      </h3>
      <p className={styles["message"]}>
        <ThreadLink url={url} />
      </p>
      <p className={styles["message"]}>{`${id} is published.`}</p>
      <div className={styles["actions"]}>
        <Button onClick={onClose}>Close</Button>
      </div>
    </>
  );
};
