/**
 * @file A finished run's declared outputs in the Monitor, as the result of the
 *   run: a card after the run summary with one entry for each output, a short
 *   value as a copy block and a longer one in a well with its own copy button.
 *   A value is plain text, as recorded (it comes from a session), and a cut one
 *   says so and points at `ork logs <run> --json`. Nothing shows while the run
 *   goes, when it declares none, or while they are read.
 */

import {
  OUTPUT_MAX_CHARS,
  OUTPUT_MAX_LINES,
  type OutputText,
} from "@krapht/ork-server/client";
import { useId } from "react";

import { CopyButton } from "../components/copy-button.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { OutputWell } from "../components/output-well.tsx";
import { GlyphFailed } from "../components/status-glyphs.tsx";
import type { RunView } from "./use-run-monitor.ts";
import { useRunOutputs } from "./use-run-outputs.ts";

import styles from "./run-outputs.module.css";

/** The longest a value can be and still be a one-line block. */
const SHORT = 80;

const isShort = ({ text, cut }: OutputText): boolean =>
  !cut && !text.includes("\n") && text.length <= SHORT;

const Entry = ({ output }: { output: OutputText }) => {
  const { name, text, cut } = output;
  const label = (
    <span className={styles["name"]}>
      {name}
      {cut ? <span className={styles["muted"]}> (cut)</span> : null}
    </span>
  );
  if (text === "") {
    return (
      <li className={styles["entry"]}>
        {label}
        <span className={styles["muted"]}>empty</span>
      </li>
    );
  }
  if (isShort(output)) {
    return (
      <li className={styles["entry"]}>
        <span className={styles["name"]}>{name}</span>
        <CopyCommand
          command={text}
          label={`Copy ${name}`}
        />
      </li>
    );
  }
  return (
    <li className={styles["entry"]}>
      <div className={styles["bar"]}>
        {label}
        <span className={styles["copy"]}>
          <CopyButton
            label={`Copy ${name}`}
            text={text}
          />
        </span>
      </div>
      <OutputWell
        follow={false}
        label={`Output ${name}`}
        text={text}
      />
    </li>
  );
};

export const RunOutputs = ({ run }: { run: RunView }) => {
  const heading = useId();
  const read = useRunOutputs(run);
  if (read.read === "none") return null;
  const command = `ork logs ${run.id}`;
  return (
    <section
      aria-labelledby={heading}
      className={styles["outputs"]}
    >
      <h3
        className={styles["heading"]}
        id={heading}
      >
        Outputs
      </h3>
      {read.read === "refused" ? (
        <>
          <p
            className={styles["error"]}
            role="alert"
          >
            <GlyphFailed /> Could not read the outputs: {read.error}. See them
            with:
          </p>
          <CopyCommand command={command} />
        </>
      ) : (
        <>
          <ul className={styles["list"]}>
            {read.outputs.map(output => (
              <Entry
                key={output.name}
                output={output}
              />
            ))}
          </ul>
          {read.outputs.some(({ cut }) => cut) ? (
            <>
              <p className={styles["note"]}>
                {`Cut at ${String(OUTPUT_MAX_LINES)} lines or ${OUTPUT_MAX_CHARS.toLocaleString("en-US")} characters. The full values:`}
              </p>
              <CopyCommand command={`${command} --json`} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
};
