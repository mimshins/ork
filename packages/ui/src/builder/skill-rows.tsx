/**
 * @file A node's skills: the ones it has, and a picker that says which layer
 *   each offered one comes from. A path can still be typed, as the format
 *   allows.
 */

import type { BuilderCatalog } from "@krapht/ork-server/client";
import { useState } from "react";

import { Button } from "../components/button.tsx";
import { Combobox } from "../components/combobox.tsx";
import { TextField } from "../components/text-field.tsx";
import type { FieldProps } from "./form-parts.tsx";

import styles from "./builder.module.css";

const listOf = (current: unknown): readonly unknown[] =>
  Array.isArray(current) ? current : [];

export const SkillRows = ({
  field,
  catalog,
}: {
  field: FieldProps;
  catalog: BuilderCatalog;
}) => {
  const skills = Array.isArray(field.value)
    ? field.value.filter((item): item is string => typeof item === "string")
    : [];
  const [typed, setTyped] = useState("");
  const add = (skill: string): void => {
    field.context.change(field.path, current =>
      listOf(current).includes(skill) ? current : [...listOf(current), skill],
    );
  };
  const offered = catalog.skills.filter(({ name }) => !skills.includes(name));
  return (
    <div className={styles["fields"]}>
      <h3 className={styles["subheading"]}>Skills</h3>
      {skills.length === 0 ? (
        <p className={styles["hint"]}>
          It gets what the workflow and the project give it.
        </p>
      ) : (
        <ul className={styles["edges"]}>
          {skills.map(skill => (
            <li
              className={styles["row"]}
              key={skill}
            >
              <span className={styles["rowName"]}>{skill}</span>
              <Button
                onClick={() => {
                  field.context.change(field.path, current => {
                    const left = listOf(current).filter(
                      other => other !== skill,
                    );
                    return left.length === 0 ? undefined : left;
                  });
                }}
              >
                Remove {skill}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Combobox
        empty="No skill matches."
        label="Add a skill"
        onChange={next => {
          if (next !== null) add(next);
        }}
        options={offered.map(({ name, layer }) => ({
          value: name,
          label: `${name} (${layer})`,
        }))}
        placeholder={
          offered.length === 0 ? "No skills found" : "Type to find a skill"
        }
        value={null}
      />
      <TextField
        description="Or a path to one, such as ./skills/checklist."
        label="Skill by path"
        onChange={setTyped}
        onCommit={() => {
          if (typed.trim() !== "") add(typed.trim());
          setTyped("");
        }}
        value={typed}
      />
    </div>
  );
};
