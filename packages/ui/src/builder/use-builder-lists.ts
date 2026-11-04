/**
 * @file What the builder offers, apart from what's open: the workflow's schema,
 *   and a project's drafts and catalog, for whichever project is chosen now.
 */

import type { BuilderCatalog } from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AppState } from "../state/app-state.ts";
import type { JsonSchema } from "./schema-model.ts";

const EMPTY_CATALOG: BuilderCatalog = { agents: [], skills: [] };

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const useBuilderLists = (client: AppState["client"]) => {
  const [schema, setSchema] = useState<JsonSchema | null>(null);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [drafts, setDrafts] = useState<readonly string[]>([]);
  const projectNow = useRef<string | null>(null);

  useEffect(() => {
    const read = async (): Promise<void> => {
      const answer = await client.call("builderSchema");
      if (answer.ok && isSchema(answer.data)) setSchema(answer.data);
    };
    void read();
  }, [client]);

  const read = useCallback(
    async (project: string): Promise<void> => {
      const params = { id: project };
      const [names, offered] = await Promise.all([
        client.call("builderDrafts", { params }),
        client.call("builderCatalog", { params }),
      ]);
      // The user can have moved to another project while these were read.
      if (projectNow.current !== project) return;
      if (names.ok) setDrafts(names.data);
      if (offered.ok) setCatalog(offered.data);
    },
    [client],
  );

  const forProject = useCallback(
    (project: string): void => {
      if (projectNow.current !== project) setDrafts([]);
      projectNow.current = project;
      void read(project);
    },
    [read],
  );

  const refreshDrafts = useCallback((): void => {
    if (projectNow.current !== null) void read(projectNow.current);
  }, [read]);

  return { schema, catalog, drafts, setDrafts, forProject, refreshDrafts };
};
