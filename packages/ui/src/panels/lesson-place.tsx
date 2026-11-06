/**
 * @file Where a lesson goes, as the CLI prints it: the file and its project,
 *   and how full the file is against the cap a session loads (amber from 80%,
 *   red at the cap), or why there's no file to write it to.
 */

import { CodeText } from "../components/code-text.tsx";
import { Meter } from "../components/meter.tsx";
import { type LessonPlace, tokensWords } from "./lesson-model.ts";

import styles from "./feedback.module.css";

export const LessonWhere = ({
  place,
  cap,
}: {
  place: LessonPlace;
  cap: number;
}) =>
  place.ok ? (
    <>
      <p className={styles["place"]}>
        <span className={styles["caption"]}>Goes to </span>
        <CodeText text={`\`${place.file}\` in \`${place.root}\``} />
      </p>
      <Meter
        label="Now"
        max={cap}
        text={
          place.exists
            ? tokensWords(place.tokens, cap)
            : "no lessons file yet; this starts it"
        }
        value={place.tokens}
      />
    </>
  ) : (
    <p className={styles["note"]}>
      <CodeText text={place.error} />
    </p>
  );
