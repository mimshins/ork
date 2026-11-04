/**
 * @file A node's edges in the inspector: each with its condition and loop
 *   limit, and the way to add one, from a list or by picking a card. Neither
 *   needs a drag, so the keyboard and a pointer do the same thing.
 */

import { conditionText, type WorkflowEdit } from "@krapht/ork-server/client";
import { useState } from "react";

import { Button } from "../components/button.tsx";
import { Select } from "../components/select.tsx";
import { Unseen } from "../components/unseen.tsx";
import {
  connectEdit,
  saysOf,
  shownCondition,
  unhandledAnswers,
} from "./condition-model.ts";
import { ConditionPicker } from "./condition-picker.tsx";
import { CommitText } from "./form-parts.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

type Edge = NonNullable<Builder["view"]>["graph"]["edges"][number];

/** Which edge this is, as two can link the same nodes. */
const whichOf = (edge: Edge) =>
  edge.when === undefined ? {} : { whenWas: edge.when };

/** One outgoing edge: when to follow it and, for a loop, how many times. */
const OutEdge = ({
  edge,
  last,
  builder,
}: {
  edge: Edge;
  /** Whether it's the last edge its node has. */
  last: boolean;
  builder: Builder;
}) => {
  const { from, to } = edge;
  const graph = builder.view?.graph;
  if (graph === undefined) return null;
  const type = graph.nodes.find(({ id }) => id === from)?.type;
  const says = saysOf(graph, from);
  const rounds =
    edge.maxRounds === undefined ? {} : { maxRounds: edge.maxRounds };
  const setWhen = (when?: string): WorkflowEdit => ({
    op: "setEdge",
    from,
    to,
    ...(when === undefined ? {} : { when }),
    ...rounds,
    ...whichOf(edge),
  });
  const loop = edge.maxRounds !== undefined;
  return (
    <li className={styles["edge"]}>
      <p className={styles["edgeName"]}>To {to}</p>
      <ConditionPicker
        canBeOtherwise={type === "control.router" && last}
        condition={shownCondition(edge, says)}
        gate={type === "human.gate"}
        loop={loop}
        onChange={when => {
          void builder.edit(setWhen(when));
        }}
        onDeclare={(name, values) => {
          const [first] = values;
          void builder.edit(
            {
              op: "set",
              path: ["nodes", from, "output", "schema", name],
              value: values,
            },
            setWhen(
              conditionText({
                mode: "test",
                join: "all",
                rows: [
                  {
                    field: `json.${name}`,
                    test: "is",
                    ...(first === undefined ? {} : { value: first }),
                  },
                ],
              }),
            ),
          );
        }}
        says={says}
        to={to}
        when={edge.when}
      />
      <CommitText
        commit={typed => {
          void builder.edit({
            op: "setEdge",
            from,
            to,
            ...(edge.when === undefined ? {} : { when: edge.when }),
            ...(typed === "" ? {} : { maxRounds: Number(typed) }),
            ...whichOf(edge),
          });
        }}
        description="Needed on an edge that closes a loop."
        label="Max rounds"
        unseen={`, to ${to}`}
        number
        shown={edge.maxRounds === undefined ? "" : String(edge.maxRounds)}
      />
      <Button
        onClick={() => {
          void builder.edit({ op: "disconnect", from, to, ...whichOf(edge) });
        }}
      >
        Remove edge
        <Unseen> to {to}</Unseen>
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
  const unhandled = unhandledAnswers(graph, id);
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
          {out.map((edge, index) => (
            <OutEdge
              builder={builder}
              edge={edge}
              // Where it is, not what it says: changing a condition keeps focus.
              key={`${edge.to} ${String(out.slice(0, index).filter(({ to }) => to === edge.to).length)}`}
              last={index === out.length - 1}
            />
          ))}
        </ul>
      )}
      {unhandled.length === 0 ? null : (
        <p className={styles["hint"]}>
          Answering {unhandled.join(" or ")} ends the run here.
        </p>
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
              void builder.edit(connectEdit(graph, id, chosen));
            }}
          >
            Connect
          </Button>
          <Button
            aria-pressed={builder.connecting}
            onClick={() => {
              builder.setConnecting(!builder.connecting);
            }}
          >
            {builder.connecting ? "Cancel picking" : "Pick a card"}
          </Button>
        </div>
      )}
    </section>
  );
};
