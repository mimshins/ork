/**
 * @file Declaring a field of a tool's JSON from the condition that reads it
 *   (RFC-010), so a value is a choice from then on, and a run checks it.
 */

import { useState } from "react";

import { Button } from "../components/button.tsx";
import { TextField } from "../components/text-field.tsx";
import { Unseen } from "../components/unseen.tsx";

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
