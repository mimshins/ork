/**
 * @file The secrets a server starts with (RFC-019): the API token (bearer), the
 *   session secret (the browser's cookie) and the sign-in code store. Each is
 *   the caller's or a new one.
 */

import { newToken } from "./guards.ts";
import { createSignInCodes, type SignInCodes } from "./sign-in-codes.ts";

export type Access = { token: string; session: string; codes: SignInCodes };

export const createAccess = (given: Partial<Access>): Access => ({
  token: given.token ?? newToken(),
  session: given.session ?? newToken(),
  codes: given.codes ?? createSignInCodes(),
});
