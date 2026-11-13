/**
 * @file One field of the list filter bar: a select for an enum, an input with
 *   suggestions for the rest, the table's description as its tip and its
 *   accessible description, and the invalid state when the server refused its
 *   value (specs/ui/design-filter-bar.md#controls-by-field-type).
 */

import type { ListFieldInfo } from "@krapht/ork-server/client";

import { FilterInput, type Suggestion } from "./filter-input.tsx";
import { labelOf } from "./filter-model.ts";
import { Select } from "./select.tsx";
import { Tip } from "./tip.tsx";
import { Unseen } from "./unseen.tsx";

import styles from "./filter-bar.module.css";

/** A select's value for "no filter on this field". */
const UNSET = "~unset";

const PERIODS = ["24h", "7d", "30d", "90d"];

/** What each text field says it takes while empty and with no default. */
const EXAMPLES: Record<string, string> = {
  workflow: "workflow name",
  run: "run id or prefix",
  project: "id, root or all",
  for: "agent, me, project:name",
  since: "24h, 30d or 2026-11-01",
  until: "2026-11-01",
};

const same = (value: string): Suggestion => ({ value, label: value });

/** The suggestions every bar offers for a field, then the panel's own. */
const suggestionsOf = (
  field: ListFieldInfo,
  extra: readonly Suggestion[],
): Suggestion[] => {
  const built =
    field.type === "since"
      ? [...PERIODS, ...(field.all === true ? ["all"] : [])].map(period =>
          same(period),
        )
      : field.name === "for"
        ? ["agent", "me"].map(word => same(word))
        : field.name === "project"
          ? [same("all")]
          : [];
  return [...built, ...extra];
};

const selectOptions = (field: ListFieldInfo, fallback: string | undefined) => [
  {
    value: UNSET,
    label: fallback === undefined ? "Any" : `Default (${fallback})`,
  },
  ...(field.values ?? []).map(value => same(value)),
  // `all` widens past a default; with none it would only equal "Any".
  ...(field.all === true && fallback !== undefined
    ? [{ value: "all", label: "All" }]
    : []),
];

export type FilterFieldProps = {
  field: ListFieldInfo;
  /** The ids of the alert, when this is the field the server refused. */
  alertId: string | undefined;
  /** A prefix that keeps this bar's ids apart from another's. */
  idPrefix: string;
  /** The panel's default for it, in its words. */
  fallback: string | undefined;
  suggestions: readonly Suggestion[];
  /** The applied value. */
  value: string | undefined;
  /** What the input shows while a draft is pending. */
  draft: string | undefined;
  /** A select's choice, or an empty text for unset. */
  onApply: (value: string) => void;
  onDraft: (text: string) => void;
  onCommit: (text: string) => void;
  onRestore: () => void;
};

export const FilterField = ({
  field,
  alertId,
  idPrefix,
  fallback,
  suggestions,
  value,
  draft,
  onApply,
  onDraft,
  onCommit,
  onRestore,
}: FilterFieldProps) => {
  const { name } = field;
  const label = labelOf(name);
  const help = `${idPrefix}-${name}-help`;
  const refused = alertId !== undefined;
  const describedBy = refused ? `${help} ${alertId}` : help;
  return (
    <Tip label={field.description}>
      <div
        className={styles["field"]}
        data-narrow={
          field.type === "since" || field.type === "until" ? "" : undefined
        }
      >
        {field.type === "enum" ? (
          <Select
            describedBy={describedBy}
            invalid={refused}
            label={label}
            onChange={next => {
              onApply(next === UNSET ? "" : next);
            }}
            options={selectOptions(field, fallback)}
            value={value ?? UNSET}
          />
        ) : (
          <FilterInput
            describedBy={describedBy}
            invalid={refused}
            label={label}
            onCommit={onCommit}
            onRestore={onRestore}
            onText={onDraft}
            placeholder={
              fallback === undefined
                ? (EXAMPLES[name] ?? "")
                : `Default: ${fallback}`
            }
            suggestions={suggestionsOf(field, suggestions)}
            text={draft ?? value ?? ""}
          />
        )}
        <Unseen>
          <span id={help}>{field.description}</span>
        </Unseen>
      </div>
    </Tip>
  );
};
