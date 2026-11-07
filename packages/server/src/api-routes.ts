/** @file Every JSON route's handler, in one place. */

import { builderRoutes } from "./builder-routes.ts";
import { contextRoutes } from "./context-routes.ts";
import type { ServerContext } from "./context.ts";
import { feedbackRoutes } from "./feedback-routes.ts";
import { readRoutes } from "./read-routes.ts";
import type { Handlers } from "./router.ts";
import { worktreesRoutes } from "./worktrees-routes.ts";
import { writeRoutes } from "./write-routes.ts";

export const apiRoutes = (context: ServerContext): Handlers => ({
  ...readRoutes(context),
  ...writeRoutes(context),
  ...builderRoutes(context),
  ...contextRoutes(context),
  ...feedbackRoutes(context),
  ...worktreesRoutes(context),
});
