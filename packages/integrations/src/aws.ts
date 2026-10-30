/**
 * @file The AWS integration: `tool.aws` nodes run the user's own `aws`, with an
 *   optional `profile` and `region`, signed in with `aws sso login` or a
 *   profile.
 */

import { z } from "zod";

import { defineIntegration } from "./integration.ts";

export const aws = defineIntegration({
  id: "aws",
  label: "AWS CLI",
  program: "aws",
  options: {
    profile: z.string().optional(),
    region: z.string().optional(),
  },
  args: ({ profile, region }) => [
    ...(profile === undefined ? [] : ["--profile", profile]),
    ...(region === undefined ? [] : ["--region", region]),
  ],
  doctor: async (exec, env) => {
    const version = await exec("aws", ["--version"]);
    if (!version.ok) {
      return {
        name: "aws",
        status: "skip",
        detail: "optional, not installed (needed only for tool.aws nodes)",
      };
    }
    const profile = env["AWS_PROFILE"];
    const suffix = profile === undefined ? "" : ` (profile ${profile})`;
    const identity = await exec("aws", [
      "sts",
      "get-caller-identity",
      "--output",
      "json",
    ]);
    return identity.ok
      ? { name: "aws", status: "ok", detail: `signed in${suffix}` }
      : {
          name: "aws",
          status: "warn",
          detail: `no valid credentials${suffix}`,
          hint: "Run `aws sso login` (or set AWS_PROFILE) yourself to use tool.aws nodes.",
        };
  },
});
