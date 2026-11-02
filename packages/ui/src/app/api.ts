/**
 * @file The UI's one client of the server's API: same origin, so the session
 *   cookie goes with every call and the UI never holds the token.
 */

import { createClient } from "@krapht/ork-server/client";

export const api = createClient();
