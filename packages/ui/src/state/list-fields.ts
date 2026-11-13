/**
 * @file The filter fields of every list, as `GET /api/list-fields` sends them
 *   (specs/ui/design-filter-bar.md): read once per page and shared by the six
 *   filter bars. A failed read can be tried again.
 */

import type { ListFieldsAnswer } from "@krapht/ork-server/client";
import { useEffect } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "./context.tsx";

export type ListFields =
  | { status: "loading"; fields: null; error: null; retry: () => void }
  | { status: "failed"; fields: null; error: string; retry: () => void }
  | {
      status: "ready";
      fields: ListFieldsAnswer;
      error: null;
      retry: () => void;
    };

/** The fields of every list: reads them the first time anyone asks. */
export const useListFields = (): ListFields => {
  const { listFields } = useAppState();
  const read = useValue(listFields.state);
  useEffect(() => {
    if (read.status === "idle") void listFields.load();
  }, [listFields, read.status]);
  const retry = (): void => {
    void listFields.load();
  };
  return read.status === "ready"
    ? { status: "ready", fields: read.data, error: null, retry }
    : read.status === "failed"
      ? { status: "failed", fields: null, error: read.error, retry }
      : { status: "loading", fields: null, error: null, retry };
};
