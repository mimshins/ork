/**
 * @file The pieces the Upgrade dialog's steps share, in `ork upgrade`'s words:
 *   the versions line, the release notes' link, the runs still running, a
 *   step's heading that takes the focus, an elapsed time that isn't read out,
 *   and the foot with its note and buttons.
 */

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import { CodeText } from "../components/code-text.tsx";
import { IconAlert, IconExternal } from "../components/icons.tsx";
import { GlyphFailed, GlyphSucceeded } from "../components/status-glyphs.tsx";
import { Unseen } from "../components/unseen.tsx";
import { useClock } from "../panels/use-clock.ts";

import styles from "./update.module.css";

/** "Ork 0.4.0 is out (you have 0.3.0).", the new version stronger. */
export const VersionsLine = ({
  latest,
  current,
}: {
  latest: string;
  current: string;
}) => (
  <p className={styles["line"]}>
    Ork{" "}
    <span
      className={styles["version"]}
      data-new=""
    >
      {latest}
    </span>{" "}
    is out (you have <span className={styles["version"]}>{current}</span>).
  </p>
);

/** The release notes, in a new tab, and saying so. */
export const ReleaseLink = ({
  url,
  version,
  children,
}: {
  url: string;
  /** Said after the link's words, when they don't name the version. */
  version?: string;
  children: ReactNode;
}) => (
  <a
    className={styles["link"]}
    href={url}
    rel="noreferrer"
    target="_blank"
  >
    {children}
    {version === undefined ? null : <Unseen>{` in ${version}`}</Unseen>}
    <IconExternal />
    <Unseen> (opens in a new tab)</Unseen>
  </a>
);

/** How many running runs are named before "and N more". */
const NAMED_RUNS = 8;

/** The runs still running, as `ork upgrade` warns of them. */
export const RunningNow = ({ ids }: { ids: readonly string[] }) => {
  if (ids.length === 0) return null;
  const named = ids.slice(0, NAMED_RUNS).map(id => `\`${id.slice(0, 8)}\``);
  const more = ids.length - NAMED_RUNS;
  const list =
    more > 0
      ? `${named.join(", ")} and ${String(more)} more`
      : named.join(", ");
  return (
    <p
      className={styles["alert"]}
      data-tone="note"
    >
      <span className={styles["alertIcon"]}>
        <IconAlert />
      </span>
      <span>
        <CodeText
          text={`Running now: ${list}. Their next sessions would start from the new install; upgrading after they finish is safer.`}
        />
      </span>
    </p>
  );
};

/** Whether the focus went with what had it, to the page or the dialog itself. */
export const focusLost = (): boolean => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active.getAttribute("role") === "dialog"
  );
};

/**
 * A step's heading, which takes the focus when it appears. It takes it as the
 * step changes, in the same commit that removed what had it, so the dialog
 * never sees the focus lost; and again two frames on if the dialog moved it to
 * itself anyway, as Base UI does when a focused element goes.
 */
export const StepHeading = ({
  tone,
  text,
  ref,
}: {
  tone?: "succeeded" | "failed";
  text: string;
  /** The heading, for a dialog that opens on this step. */
  ref?: RefObject<HTMLHeadingElement | null>;
}) => {
  const own = useRef<HTMLHeadingElement>(null);
  const heading = ref ?? own;
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [heading]);
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (focusLost()) heading.current?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [heading]);
  return (
    <h3
      className={styles["heading"]}
      ref={heading}
      tabIndex={-1}
    >
      {tone === undefined ? null : (
        <span
          className={styles["glyph"]}
          data-tone={tone}
        >
          {tone === "succeeded" ? <GlyphSucceeded /> : <GlyphFailed />}
        </span>
      )}
      <span>
        <CodeText text={text} />
      </span>
    </h3>
  );
};

/** Seconds since `since`, in mono; a clock is not news, so it isn't read. */
export const Elapsed = ({ since }: { since: number }) => {
  const now = useClock(true);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span
      aria-hidden="true"
      className={styles["clock"]}
    >
      {`${String(seconds)} s`}
    </span>
  );
};

/** A refusal or a failure, said as it appears. */
export const Alert = ({
  text,
  icon = false,
}: {
  text: string | null;
  icon?: boolean;
}) =>
  text === null ? null : (
    <p
      className={styles["alert"]}
      role="alert"
    >
      {icon ? <IconAlert /> : null}
      {/* One flex item: the words and their code wrap as one sentence. */}
      <span>
        <CodeText text={text} />
      </span>
    </p>
  );

/**
 * Why a button can't be pressed now. Always there, so the reason is heard as it
 * changes; the button points at its `id` (`aria-describedby`).
 */
export const Reason = ({ why, id }: { why: string | null; id: string }) => (
  <output
    className={styles["note"]}
    id={id}
  >
    <CodeText text={why ?? ""} />
  </output>
);

/** The dialog's foot: a note on the left, the buttons at the end. */
export const Foot = ({
  note,
  children,
}: {
  note?: string | undefined;
  children: ReactNode;
}) => (
  <div className={styles["foot"]}>
    {note === undefined ? null : (
      <p className={styles["note"]}>
        <CodeText text={note} />
      </p>
    )}
    <div className={styles["actions"]}>{children}</div>
  </div>
);
