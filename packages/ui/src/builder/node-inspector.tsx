/**
 * @file The inspector: the selected node's name, its fields and its edges, or
 *   the workflow's own settings when none is selected.
 */

import { useRef, useState } from "react";

import { Button } from "../components/button.tsx";
import { TextField } from "../components/text-field.tsx";
import { typeWord } from "../graph/facts.ts";
import { Connections } from "./connections.tsx";
import { isRecord } from "./form-parts.tsx";
import { nodeSchemaOf } from "./schema-model.ts";
import { contextFor, TopFields } from "./top-fields.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

const typeOf = (node: unknown): string =>
  isRecord(node) && typeof node["type"] === "string" ? node["type"] : "";

const NodeInspector = ({ id, builder }: { id: string; builder: Builder }) => {
  const { view, schema } = builder;
  const [name, setName] = useState(id);
  // Enter then Tab commits twice, and the second would ask for a gone name.
  const sentName = useRef(id);
  const document = view?.document;
  const nodes = isRecord(document) ? document["nodes"] : undefined;
  const node = isRecord(nodes) ? nodes[id] : undefined;
  const type = typeOf(node);
  const nodeSchema = schema === null ? undefined : nodeSchemaOf(schema, type);
  const rename = async (): Promise<void> => {
    if (name === sentName.current) return;
    sentName.current = name;
    const done = await builder.edit({ op: "renameNode", from: id, to: name });
    if (done) {
      builder.select(name);
    } else {
      sentName.current = id;
      setName(id);
    }
  };
  const remove = async (): Promise<void> => {
    if (await builder.edit({ op: "removeNode", id })) builder.select(null);
  };
  return (
    <div className={styles["fields"]}>
      <h2 className={styles["heading"]}>{typeWord(type)}</h2>
      <TextField
        description="Lowercase, and read by other nodes. A new name follows every reference."
        label="Name"
        onChange={setName}
        onCommit={() => {
          void rename();
        }}
        value={name}
      />
      {nodeSchema === undefined ? (
        <p className={styles["hint"]}>
          This node has no known type, so there are no fields to show.
        </p>
      ) : (
        <TopFields
          context={contextFor(builder, id, view?.diagnostics ?? [])}
          hide={["type"]}
          path={["nodes", id]}
          schema={nodeSchema}
          value={node}
        />
      )}
      <Connections
        builder={builder}
        id={id}
      />
      <Button
        onClick={() => {
          void remove();
        }}
        variant="ghost"
      >
        Remove {id}
      </Button>
    </div>
  );
};

const WorkflowInspector = ({ builder }: { builder: Builder }) => {
  const { view, schema } = builder;
  if (schema === null) return null;
  return (
    <div className={styles["fields"]}>
      <h2 className={styles["heading"]}>Workflow</h2>
      <TopFields
        context={contextFor(builder, null, view?.diagnostics ?? [])}
        hide={["schemaVersion", "nodes", "edges"]}
        path={[]}
        schema={schema}
        value={view?.document}
      />
    </div>
  );
};

export const Inspector = ({ builder }: { builder: Builder }) => {
  const { selected, view } = builder;
  const known = view?.graph.nodes.some(({ id }) => id === selected) === true;
  return selected !== null && known ? (
    <NodeInspector
      builder={builder}
      id={selected}
      key={selected}
    />
  ) : (
    <WorkflowInspector builder={builder} />
  );
};
