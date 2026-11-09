/**
 * @file Declaring a field of a tool's JSON from the condition that reads it
 *   (RFC-010), so a value is a choice from then on, and a run checks it; and
 *   declaring a list from the node that fans out over it (RFC-013).
 */

import { useRef, useState } from "react";

import { Button } from "../components/button.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import { Unseen } from "../components/unseen.tsx";
import {
  type ItemShape,
  isFieldName,
  readItemFields,
} from "./for-each-model.ts";
import { Problems } from "./form-parts.tsx";

import styles from "./builder.module.css";

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/** What's typed as a list of values: numbers and booleans as what they are. */
export const valuesFrom = (typed: string): (string | number | boolean)[] =>
  typed
    .split(",")
    .map(value => value.trim())
    .filter(value => value !== "")
    .map(value => {
      if (value === "true") return true;
      if (value === "false") return false;
      return Number.isFinite(Number(value)) ? Number(value) : value;
    });

export const DeclareField = ({
  to,
  onDeclare,
}: {
  to: string;
  onDeclare: (
    name: string,
    values: readonly (string | number | boolean)[],
  ) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  if (!open) {
    return (
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Add a field
        <Unseen>, to {to}</Unseen>
      </Button>
    );
  }
  const values = valuesFrom(typed);
  return (
    <>
      <TextField
        description="A field of the JSON this node gives, such as state."
        label="New field"
        unseen={`, to ${to}`}
        onChange={setName}
        value={name}
      />
      <TextField
        description="Separated by commas. A run fails this node on anything else."
        label="Its values"
        unseen={`, to ${to}`}
        onChange={setTyped}
        value={typed}
      />
      <Button
        disabled={!NAME.test(name) || values.length === 0}
        onClick={() => {
          onDeclare(name, values);
          setOpen(false);
          setName("");
          setTyped("");
        }}
      >
        Add {name === "" ? "field" : name}
      </Button>
    </>
  );
};

/** A node that can declare a list, and the fields it has already. */
export type ListHolder = { id: string; fields: readonly string[] };

/** Where focus goes once a form opens, or comes back to once it closes. */
const focusIn = (box: HTMLElement | null, selector: string): void => {
  box?.querySelector<HTMLElement>(selector)?.focus();
};

/**
 * Declares a list on an earlier node, with the fields each item has: a button
 * that opens a small form, as Add a field does. `holders` is empty when no
 * earlier node can declare one.
 */
export const DeclareList = ({
  to,
  holders,
  onDeclare,
}: {
  to: string;
  holders: readonly ListHolder[];
  onDeclare: (node: string, name: string, shape: ItemShape) => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  const holder = holders.find(({ id }) => id === chosen) ?? holders[0];
  if (holder === undefined) {
    return (
      <>
        <Button disabled>
          Add a list
          <Unseen>, for {to}</Unseen>
        </Button>
        <p className={styles["hint"]}>
          No earlier node can declare a list. A list comes from a Claude node,
          tool or MCP call that runs before this one.
        </p>
      </>
    );
  }
  if (!open) {
    return (
      <div ref={box}>
        <Button
          onClick={() => {
            setOpen(true);
            // The form isn't drawn until this render is done.
            queueMicrotask(() => {
              focusIn(box.current, "input, [role=combobox]");
            });
          }}
        >
          Add a list
          <Unseen>, for {to}</Unseen>
        </Button>
      </div>
    );
  }
  const items = readItemFields(typed);
  const taken = holder.fields.includes(name);
  const nameProblem =
    name !== "" && !isFieldName(name)
      ? [`\`${name}\` isn't a name. Use letters, digits, _ or -.`]
      : taken
        ? [`\`${name}\` is already a field of \`${holder.id}\`.`]
        : [];
  const close = (): void => {
    setOpen(false);
    setName("");
    setTyped("");
    queueMicrotask(() => {
      focusIn(box.current, "button");
    });
  };
  return (
    <div
      className={styles["fields"]}
      ref={box}
    >
      {holders.length < 2 ? null : (
        <Select
          label="On node"
          onChange={setChosen}
          options={holders.map(({ id }) => ({ value: id, label: id }))}
          value={holder.id}
        />
      )}
      <TextField
        description="A field of the JSON that node gives, such as tasks."
        label="New list"
        onChange={setName}
        value={name}
      />
      <Problems lines={nameProblem} />
      <TextField
        description="Separated by commas: a name, or name:type. Types: string, number, integer, boolean. Empty for items with no fields."
        label="Item fields"
        onChange={setTyped}
        value={typed}
      />
      <Problems lines={items.problems} />
      <Button
        disabled={!isFieldName(name) || taken || items.problems.length > 0}
        onClick={() => {
          onDeclare(holder.id, name, items.shape);
          close();
        }}
      >
        Add {name === "" ? "list" : name}
      </Button>
      <Button onClick={close}>Cancel</Button>
    </div>
  );
};
