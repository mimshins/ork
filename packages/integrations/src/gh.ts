/**
 * @file The GitHub integration: `tool.gh` nodes run the user's own `gh`, signed
 *   in with `gh auth login`.
 */

import { defineIntegration } from "./integration.ts";
import { field, parseJson } from "./json.ts";

export const gh = defineIntegration({
  id: "gh",
  label: "GitHub CLI",
  program: "gh",
  options: {},
  args: () => [],
  doctor: async exec => {
    const version = await exec("gh", ["--version"]);
    if (!version.ok) {
      return {
        name: "gh",
        status: "skip",
        detail: "optional, not installed (needed only for tool.gh nodes)",
      };
    }
    const status = parseJson(
      (await exec("gh", ["auth", "status", "--json", "hosts"])).stdout,
    );
    const accounts = field(field(status, "hosts"), "github.com");
    const list: readonly unknown[] = Array.isArray(accounts) ? accounts : [];
    const active = list.find(a => field(a, "active") === true);
    const login = field(active, "login");
    if (field(active, "state") !== "success" || typeof login !== "string") {
      return {
        name: "gh",
        status: "warn",
        detail: "not logged in to github.com",
        hint: "Run `gh auth login` yourself to use tool.gh nodes.",
      };
    }
    return { name: "gh", status: "ok", detail: `logged in as ${login}` };
  },
});
