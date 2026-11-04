/**
 * @file A node's edges in the inspector: each with its condition and loop
 *   limit, and the way to add one, from a list or by picking a card. Neither
 *   needs a drag, so the keyboard and a pointer do the same thing.
 */

import { useState } from "react";

import { Button } from "../components/button.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

type Edge = NonNullable<Builder["view"]>["graph"]["edges"][number];

const optionsOf = (edge: Edge) => ({
  ...(edge.when === undefined ? {} : { when: edge.when }),
  ...(edge.maxRounds === undefined ? {} : { maxRounds: edge.maxRounds }),
});

/** Which edge this is, as two can link the same nodes. */
const whichOf = (edge: Edge) =>
  edge.when === undefined ? {} : { whenWas: edge.when };

const both = (when: string, rounds: string) => ({
  ...(when === "" ? {} : { when }),
  ...(rounds === "" ? {} : { maxRounds: Number(rounds) }),
});

/** One outgoing edge, whose text fields commit when they're left. */
const OutEdge = ({ edge, builder }: { edge: Edge; builder: Builder }) => {
  const [when, setWhen] = useState(edge.when ?? "");
  const [rounds, setRounds] = useState(
    edge.maxRounds === undefined ? "" : String(edge.maxRounds),
  );
  const { from, to } = edge;
  const change = (next: { when?: string; maxRounds?: number }): void => {
    void builder.edit({ op: "setEdge", from, to, ...next, ...whichOf(edge) });
  };
  return (
    <li className={styles["edge"]}>
      <p className={styles["edgeName"]}>To {to}</p>
      <TextField
        description="Follow this edge only when this holds, such as status == 'pass'."
        label={`Condition, to ${to}`}
        onChange={setWhen}
        onCommit={() => {
          if (when !== (edge.when ?? "")) change(both(when, rounds));
        }}
        value={when}
      />
      <TextField
        description="Needed on an edge that closes a loop."
        label={`Max rounds, to ${to}`}
        onChange={setRounds}
        onCommit={() => {
          const old =
            edge.maxRounds === undefined ? "" : String(edge.maxRounds);
          if (rounds !== old) change(both(when, rounds));
        }}
        type="number"
        value={rounds}
      />
      <Button
        onClick={() => {
          void builder.edit({ op: "disconnect", from, to, ...whichOf(edge) });
        }}
        variant="ghost"
      >
        Remove edge to {to}
      </Button>
    </li>
  );
};

export const Connections = ({
  id,
  builder,
}: {
  id: string;
  builder: Builder;
}) => {
  const graph = builder.view?.graph;
  const [target, setTarget] = useState("");
  if (graph === undefined) return null;
  const out = graph.edges.filter(({ from }) => from === id);
  const into = graph.edges.filter(({ to }) => to === id);
  // Itself goes last: a loop back to the same node is the rare case.
  const free = graph.nodes
    .map(node => node.id)
    .filter(other => !out.some(({ to }) => to === other))
    .toSorted((a, b) => Number(a === id) - Number(b === id));
  const chosen = free.includes(target) ? target : (free[0] ?? "");
  return (
    <section
      aria-label={`Edges of ${id}`}
      className={styles["fields"]}
    >
      <h3 className={styles["subheading"]}>Edges</h3>
      {into.length === 0 ? null : (
        <p className={styles["hint"]}>
          From {into.map(({ from }) => from).join(", ")}
        </p>
      )}
      {out.length === 0 ? (
        <p className={styles["hint"]}>Nothing follows this node yet.</p>
      ) : (
        <ul className={styles["edges"]}>
          {out.map(edge => (
            <OutEdge
              builder={builder}
              edge={edge}
              key={`${edge.to} ${optionsKey(edge)}`}
            />
          ))}
        </ul>
      )}
      {free.length === 0 ? null : (
        <div className={styles["connect"]}>
          <Select
            label="Connect to"
            onChange={setTarget}
            options={free.map(value => ({ value, label: value }))}
            value={chosen}
          />
          <Button
            onClick={() => {
              void builder.edit({ op: "connect", from: id, to: chosen });
            }}
          >
            Connect
          </Button>
          <Button
            aria-pressed={builder.connecting}
            onClick={() => {
              builder.setConnecting(!builder.connecting);
            }}
            variant="ghost"
          >
            {builder.connecting ? "Cancel picking" : "Pick a card"}
          </Button>
        </div>
      )}
    </section>
  );
};

const optionsKey = (edge: Edge): string => JSON.stringify(optionsOf(edge));
