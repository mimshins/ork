/**
 * @file `ork agents list`'s field table (RFC-017): the catalog's row type lives
 *   in core but its list is the CLI's, so the table is declared here with the
 *   same machinery; `--source` is where the agent comes from, `--ids` the
 *   names.
 */

import {
  AGENT_SOURCES,
  type CatalogAgent,
  type ListTable,
} from "@krapht/ork-core";

/** The agents list's filters: `--source`; the id is the agent's name. */
export const agentListTable: ListTable<CatalogAgent> = {
  fields: [
    {
      name: "source",
      description: "Only agents from here: builtin, user or project",
      type: "enum",
      values: AGENT_SOURCES,
      get: agent => agent.source,
    },
  ],
  id: agent => agent.name,
};
