/** @file Every JSON route's handler, in one place. */

import { builderRoutes } from "./builder-routes.ts";
import type { ServerContext } from "./context.ts";
import { readRoutes } from "./read-routes.ts";
import type { Handlers } from "./router.ts";
import { writeRoutes } from "./write-routes.ts";

export const apiRoutes = (context: ServerContext): Handlers => ({
  ...readRoutes(context),
  ...writeRoutes(context),
  ...builderRoutes(context),
});
