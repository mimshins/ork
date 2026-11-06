/**
 * @file Posting feedback about Ork to its GitHub Discussions (ADR-059) with the
 *   person's own `gh`, never a token of Ork's: the "Agent feedback" category of
 *   `mimshins/ork`, found by its slug. The category's 100 most recently updated
 *   threads are read first; one whose body carries the item's fingerprint
 *   marker gets a "+1" comment, and otherwise a new thread starts.
 */

import { execFile } from "node:child_process";

import { field, parseJson } from "@krapht/ork-integrations";

import { fingerprintMarker, type Post } from "./redact.ts";

/** Where feedback about Ork goes. */
export const DISCUSSIONS = {
  owner: "mimshins",
  name: "ork",
  category: "agent-feedback",
} as const;

/** How many of the category's newest threads are searched for the marker. */
export const THREADS_SEARCHED = 100;

export type GhResult = { ok: boolean; stdout: string; stderr: string };

/** Runs the person's `gh` with these arguments. */
export type GhRunner = (args: readonly string[]) => Promise<GhResult>;

/** The real `gh`, on `PATH`. */
export const runGh: GhRunner = args =>
  new Promise(resolve => {
    execFile(
      "gh",
      [...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const missing =
          error !== null && "code" in error && error.code === "ENOENT";
        resolve({
          ok: error === null,
          stdout,
          stderr: missing
            ? "`gh` isn't installed: install the GitHub CLI and run `gh auth login` yourself."
            : stderr,
        });
      },
    );
  });

/**
 * What publishing will do, found by reading only: start a thread, or comment
 * "+1" on the one that carries the item's marker.
 */
export type PostPlan =
  | { kind: "create"; repo: string; cat: string }
  | { kind: "comment"; thread: string; url: string };

export type Posted =
  | { ok: true; url: string; kind: "created" | "commented" }
  | { ok: false; error: string };

type Vars = Record<string, string>;

/** One GraphQL call through `gh api graphql`; its `data`, or why it failed. */
const graphql = async (
  gh: GhRunner,
  query: string,
  vars: Vars,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(vars)) {
    args.push("-f", `${name}=${value}`);
  }
  const result = await gh(args);
  if (!result.ok) {
    const why = result.stderr.trim() || result.stdout.trim();
    return { ok: false, error: `gh failed: ${why || "no output"}` };
  }
  const parsed = parseJson(result.stdout);
  return parsed === undefined
    ? { ok: false, error: "gh answered with something that isn't JSON." }
    : { ok: true, data: field(parsed, "data") };
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const PLACE = `query($owner:String!,$name:String!,$slug:String!){repository(owner:$owner,name:$name){id discussionCategory(slug:$slug){id}}}`;

const THREADS = `query($owner:String!,$name:String!,$cat:ID!){repository(owner:$owner,name:$name){discussions(categoryId:$cat,first:${String(THREADS_SEARCHED)},orderBy:{field:UPDATED_AT,direction:DESC}){nodes{id url body}}}}`;

const CREATE = `mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{url}}}`;

const COMMENT = `mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}`;

/** Finds where `post` goes, reading only: its thread, or the category. */
export const planPost = async (
  post: Post,
  gh: GhRunner = runGh,
): Promise<{ ok: true; plan: PostPlan } | { ok: false; error: string }> => {
  const where = { owner: DISCUSSIONS.owner, name: DISCUSSIONS.name };
  const place = await graphql(gh, PLACE, {
    ...where,
    slug: DISCUSSIONS.category,
  });
  if (!place.ok) return place;
  const repository = field(place.data, "repository");
  const repo = text(field(repository, "id"));
  const cat = text(field(field(repository, "discussionCategory"), "id"));
  if (repo === "" || cat === "") {
    return {
      ok: false,
      error: `No \`${DISCUSSIONS.category}\` category in the Discussions of \`${DISCUSSIONS.owner}/${DISCUSSIONS.name}\`.`,
    };
  }
  const threads = await graphql(gh, THREADS, { ...where, cat });
  if (!threads.ok) return threads;
  const nodes = field(
    field(field(threads.data, "repository"), "discussions"),
    "nodes",
  );
  const marker = fingerprintMarker(post.fingerprint);
  const list: readonly unknown[] = Array.isArray(nodes) ? nodes : [];
  const thread = list.find(node => text(field(node, "body")).includes(marker));
  return thread === undefined
    ? { ok: true, plan: { kind: "create", repo, cat } }
    : {
        ok: true,
        plan: {
          kind: "comment",
          thread: text(field(thread, "id")),
          url: text(field(thread, "url")),
        },
      };
};

/** Sends `post` as `plan` says: the only call that writes to GitHub. */
export const sendPost = async (
  post: Post,
  plan: PostPlan,
  gh: GhRunner = runGh,
): Promise<Posted> => {
  if (plan.kind === "comment") {
    const commented = await graphql(gh, COMMENT, {
      id: plan.thread,
      body: post.comment,
    });
    if (!commented.ok) return commented;
    const url = text(
      field(
        field(field(commented.data, "addDiscussionComment"), "comment"),
        "url",
      ),
    );
    return { ok: true, url: url === "" ? plan.url : url, kind: "commented" };
  }
  const created = await graphql(gh, CREATE, {
    repo: plan.repo,
    cat: plan.cat,
    title: post.title,
    body: post.body,
  });
  if (!created.ok) return created;
  const url = text(
    field(field(field(created.data, "createDiscussion"), "discussion"), "url"),
  );
  return { ok: true, url, kind: "created" };
};
