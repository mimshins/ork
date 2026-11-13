/**
 * @file The list filter bar (specs/ui/design-filter-bar.md), shared by the six
 *   list panels: the list's fields as `GET /api/list-fields` sends them, one
 *   control each (a select for an enum, an input with suggestions for text, a
 *   `for` and an age or day), so a filter set here is the same words as the
 *   CLI's flags. The bar holds the drafts of uncommitted text, the count line
 *   and the matching `ork` command; the panel holds the applied values, the
 *   fetch and the server's refusal. `FilterEmpty` is the panel's empty state
 *   for a filter that hides everything.
 */

import type { ListName } from "@krapht/ork-server/client";
import { useId, useRef, useState } from "react";

import { useListFields } from "../state/list-fields.ts";
import { Button } from "./button.tsx";
import { CopyCommand } from "./copy-command.tsx";
import { FilterField } from "./filter-field.tsx";
import type { Suggestion } from "./filter-input.tsx";
import {
  errorField,
  type FilterValues,
  filterCommand,
  isFiltered,
  LIST_WORDS,
  matchLine,
  withField,
} from "./filter-model.ts";
import { FieldsFailed, FilterAlert } from "./filter-notes.tsx";

import styles from "./filter-bar.module.css";

export type FilterBarProps = {
  /** Picks the table's fields, the nouns, the command and the bar's name. */
  list: ListName;
  /** The applied values, as the query sent. */
  values: FilterValues;
  /** The whole next record, empties removed; called on commit and on clear. */
  onChange: (next: FilterValues) => void;
  /** The server's 400 for `values`. `field` is read from its leading `--name`. */
  error?: { message: string; field?: string } | null;
  /** A refetch is in flight. */
  busy?: boolean;
  /** Rows the filtered list shows; null before the first read. */
  shown?: number | null;
  /** The panel's status line while unfiltered ("3 due, 5 waiting"). */
  summary?: string;
  /** The panel's default for a field, in its words ("not dismissed"). */
  defaults?: Partial<Record<string, string>>;
  /** Extra suggestions for `text`, `for` and `project` fields, no counts. */
  suggestions?: Partial<Record<string, readonly Suggestion[]>>;
};

const REFUSED =
  "The list shows the last filter that worked. Fix the value, or clear the filter.";

const NO_DEFAULTS: Partial<Record<string, string>> = {};
const NO_SUGGESTIONS: Partial<Record<string, readonly Suggestion[]>> = {};

/** Without a draft for `name`. */
const without = (
  drafts: Record<string, string>,
  name: string,
): Record<string, string> => {
  const { [name]: _dropped, ...rest } = drafts;
  return rest;
};

export const FilterBar = ({
  list,
  values,
  onChange,
  error = null,
  busy = false,
  shown = null,
  summary,
  defaults = NO_DEFAULTS,
  suggestions = NO_SUGGESTIONS,
}: FilterBarProps) => {
  const read = useListFields();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  /** Set while Clear filter is pressed, so the field it leaves applies nothing. */
  const clearing = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState(false);
  const words = LIST_WORDS[list];
  const filtered = isFiltered(values);
  const refusedField =
    error === null ? undefined : (error.field ?? errorField(error.message));
  const alertId = `${id}-alert`;

  const apply = (next: FilterValues): void => {
    setCleared(false);
    onChange(next);
  };
  const commit = (name: string, text: string): void => {
    if (clearing.current) return;
    setDrafts(before => without(before, name));
    const next = text.trim();
    if (next !== (values[name] ?? "")) apply(withField(values, name, next));
  };
  const clear = (): void => {
    clearing.current = false;
    setDrafts({});
    setCleared(true);
    onChange({});
    root.current
      ?.querySelector<HTMLElement>("input, [role='combobox']")
      ?.focus();
  };

  const fields = (read.fields?.[list] ?? []).filter(
    field =>
      field.name !== "project" ||
      (suggestions["project"]?.length ?? 0) >= 2 ||
      values["project"] !== undefined,
  );
  const command = filterCommand(list, values);
  const count = cleared
    ? "Filter cleared."
    : busy
      ? "Updating…"
      : filtered
        ? shown === null
          ? ""
          : matchLine(list, shown)
        : (summary ?? "");

  return (
    <search
      // `<search>` alone is not in every accessibility tree yet, nor in the test library's.
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles
      role="search"
      aria-label={`Filter ${words.bar}`}
      className={styles["bar"]}
      ref={root}
    >
      {read.status === "loading" ? (
        <output className={styles["note"]}>Reading filters…</output>
      ) : null}
      {read.status === "failed" ? (
        <FieldsFailed
          error={read.error}
          list={list}
          onRetry={read.retry}
        />
      ) : null}
      {read.status === "ready" ? (
        <div className={styles["fields"]}>
          {fields.map(field => (
            <FilterField
              alertId={refusedField === field.name ? alertId : undefined}
              draft={drafts[field.name]}
              field={field}
              fallback={defaults[field.name]}
              idPrefix={id}
              key={field.name}
              onApply={next => {
                apply(withField(values, field.name, next));
              }}
              onCommit={text => {
                commit(field.name, text);
              }}
              onDraft={text => {
                setDrafts(before => ({ ...before, [field.name]: text }));
              }}
              onRestore={() => {
                setDrafts(before => without(before, field.name));
              }}
              suggestions={suggestions[field.name] ?? []}
              value={values[field.name]}
            />
          ))}
        </div>
      ) : null}
      <output className={styles["count"]}>{count}</output>
      {error === null ? null : (
        <FilterAlert
          id={alertId}
          text={`${error.message} ${REFUSED}`}
        />
      )}
      {filtered ? (
        <div className={styles["actions"]}>
          <Button
            cli={words.command}
            onBlur={() => {
              clearing.current = false;
            }}
            onClick={clear}
            onPointerDown={() => {
              clearing.current = true;
            }}
            variant="ghost"
          >
            Clear filter
          </Button>
          <CopyCommand
            command={command}
            label={`Copy command (${command})`}
          />
        </div>
      ) : null}
    </search>
  );
};
