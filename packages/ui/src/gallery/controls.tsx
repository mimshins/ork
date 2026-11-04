/**
 * @file The gallery's section of what sits on the page: buttons, statuses,
 *   toggles, meters and the small pieces of copy.
 */

import { useState } from "react";

import { EmptyState, Kbd } from "../components/bits.tsx";
import { Button, IconButton } from "../components/button.tsx";
import { Checkbox, Switch } from "../components/checkbox.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconPause, IconPlay, IconStop } from "../components/icons.tsx";
import { Meter } from "../components/meter.tsx";
import { type Status, StatusBadge } from "../components/status-badge.tsx";
import { Section } from "./section.tsx";

import styles from "./gallery.module.css";

const STATUSES: Status[] = [
  "running",
  "succeeded",
  "waiting",
  "paused",
  "failed",
  "crashed",
  "queued",
  "skipped",
  "interrupted",
  "budget_exhausted",
  "quota_exhausted",
  "timed_out",
];

export const Controls = () => {
  const [check, setCheck] = useState(true);
  const [on, setOn] = useState(false);
  return (
    <>
      <Section title="Buttons">
        <Button variant="primary">Run workflow</Button>
        <Button cli="ork logs 4f2a1c">Logs</Button>
        <Button variant="danger">Stop run</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
        <IconButton
          cli="ork continue 4f2a1c"
          label="Continue run"
        >
          <IconPlay />
        </IconButton>
        <IconButton
          cli="ork pause 4f2a1c"
          label="Pause run"
        >
          <IconPause />
        </IconButton>
        <IconButton
          cli="ork stop 4f2a1c"
          label="Stop run"
          variant="danger"
        >
          <IconStop />
        </IconButton>
      </Section>
      <Section title="Status">
        {STATUSES.map(status => (
          <StatusBadge
            key={status}
            status={status}
          />
        ))}
      </Section>
      <Section title="Status, as a pill">
        {STATUSES.map(status => (
          <StatusBadge
            key={status}
            pill
            status={status}
          />
        ))}
      </Section>
      <Section title="Toggles">
        <Checkbox
          checked={check}
          label="Follow live"
          onChange={setCheck}
        />
        <Checkbox
          checked
          disabled
          label="Disabled"
          onChange={setCheck}
        />
        <Switch
          checked={on}
          label="Desktop notifications"
          onChange={setOn}
        />
      </Section>
      <Section title="Meters">
        <div className={styles["meter"]}>
          <Meter
            label="Budget"
            max={2}
            text="$0.42 of $2.00"
            value={0.42}
          />
        </div>
        <div className={styles["meter"]}>
          <Meter
            label="Budget"
            max={2}
            text="$1.82 of $2.00"
            value={1.82}
          />
        </div>
        <div className={styles["meter"]}>
          <Meter
            label="Budget"
            max={2}
            text="$2.00 of $2.00"
            value={2}
          />
        </div>
      </Section>
      <Section title="Copy">
        <Kbd keys={["⌘", "K"]} />
        <CopyCommand command="ork logs 4f2a1c --follow" />
        <p>
          A <a href="#link">link</a> and <code>4f2a1c</code>.
        </p>
      </Section>
      <Section title="Empty state">
        <EmptyState title="No runs yet.">
          Start one with Run workflow or <code>ork run &lt;workflow&gt;</code>.
        </EmptyState>
      </Section>
    </>
  );
};
