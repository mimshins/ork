/**
 * @file The Logs panel's filters: by node, which is the shared selection, by
 *   event type and by text.
 */

import type { StoredEvent } from "@krapht/ork-server/client";

import { Combobox } from "../components/combobox.tsx";
import { TextField } from "../components/text-field.tsx";
import { nodeOption, nodesIn, typesIn } from "./logs-model.ts";

import styles from "./logs.module.css";

const asOptions = (values: readonly string[]) =>
  values.map(value => ({ value, label: value }));

export const LogFiltersBar = ({
  events,
  node,
  type,
  text,
  onNode,
  onType,
  onText,
}: {
  events: readonly StoredEvent[];
  node: string | null;
  type: string | null;
  text: string;
  onNode: (node: string | null) => void;
  onType: (type: string | null) => void;
  onText: (text: string) => void;
}) => {
  const nodes = nodesIn(events, node);
  const nodeOptions = nodes.map(id => nodeOption(id, nodes));
  return (
    <div className={styles["tools"]}>
      <Combobox
        empty="No node matches."
        label="Node"
        onChange={onNode}
        options={nodeOptions}
        placeholder="All nodes"
        value={node}
      />
      <Combobox
        empty="No event type matches."
        label="Event"
        onChange={onType}
        options={asOptions(typesIn(events))}
        placeholder="All events"
        value={type}
      />
      <TextField
        label="Text"
        onChange={onText}
        value={text}
      />
    </div>
  );
};
