/**
 * @file The `ork feedback` subcommands that move feedback off this machine,
 *   only when the person says so (ADR-059): `publish` shares an item about Ork
 *   with its maintainers, through the person's own `gh`, after showing exactly
 *   what will be posted; `export` and `import` move records as JSON lines.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import { planPost, sendPost } from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, style, write, writeErr } from "../output.ts";
import { registeredProjects } from "../project/place.ts";
import { findFeedbackItem } from "../runs/feedback.ts";
import { exportLines, parseLines } from "../runs/jsonl.ts";
import { formatPreview, previewPost } from "../runs/publish.ts";
import { withStore } from "../store.ts";

const failed = (message: string): void => {
  writeErr(message);
  process.exitCode = 1;
};

export const publish = defineCommand({
  meta: {
    name: "publish",
    description:
      "Share an item about Ork with its maintainers, after showing exactly what goes",
  },
  args: {
    item: {
      type: "positional",
      description: "A feedback item's id, or a prefix of one",
      required: true,
    },
    "hide-names": {
      type: "boolean",
      description: "Also hide the repositories' and workflows' names",
      default: false,
    },
  },
  run: ({ args }) =>
    withStore(async store => {
      if (!process.stdin.isTTY) {
        failed(
          "publish shows what it will post and asks you first: run it in a terminal.",
        );
        return;
      }
      const found = findFeedbackItem(store, args.item);
      if (!found.ok) {
        failed(found.error);
        return;
      }
      const preview = previewPost(store, found.item, {
        home: homedir(),
        registered: registeredProjects(),
        hideNames: args["hide-names"],
      });
      if (!preview.ok) {
        failed(preview.error);
        return;
      }
      const planned = await planPost(preview.post);
      if (!planned.ok) {
        failed(planned.error);
        return;
      }
      for (const line of formatPreview(preview.post, planned.plan)) write(line);
      write("");
      if (!(await confirm("Post it with your own gh login? [y/N] "))) {
        write("Nothing was sent.");
        return;
      }
      const sent = await sendPost(preview.post, planned.plan);
      if (!sent.ok) {
        failed(sent.error);
        return;
      }
      store.setFeedbackStatus(found.item.id, "published");
      write(
        `${style("green", "✓")} ${sent.kind === "created" ? "posted" : "added a +1 to"} ${sent.url}`,
      );
    }),
});

export const exportFeedback = defineCommand({
  meta: {
    name: "export",
    description: "Write feedback records as JSON lines, to share them",
  },
  args: {
    all: {
      type: "boolean",
      description: "Dismissed items' records too",
      default: false,
    },
    output: {
      type: "string",
      alias: "o",
      description: "A file to write (default: the terminal)",
    },
  },
  run: ({ args }) =>
    withStore(store => {
      const records = store.exportFeedback({ all: args.all });
      const text = exportLines(records);
      if (args.output === undefined) {
        process.stdout.write(text);
        return;
      }
      writeFileSync(args.output, text);
      write(
        `${style("green", "✓")} wrote ${String(records.length)} record(s) to ${args.output}`,
      );
    }),
});

export const importFeedback = defineCommand({
  meta: {
    name: "import",
    description: "Add feedback records from a JSON-lines file",
  },
  args: {
    file: {
      type: "positional",
      description: "What `ork feedback export` wrote",
      required: true,
    },
  },
  run: ({ args }) =>
    withStore(store => {
      let text: string;
      try {
        text = readFileSync(args.file, "utf8");
      } catch {
        failed(`Can't read ${args.file}.`);
        return;
      }
      const { records, problems } = parseLines(text);
      const added = records.filter(r => store.importFeedback(r)).length;
      for (const problem of problems) writeErr(problem);
      write(
        `${style("green", "✓")} added ${String(added)} record(s); ${String(records.length - added)} were here already${problems.length === 0 ? "" : `; ${String(problems.length)} line(s) left out`}`,
      );
      if (problems.length > 0) process.exitCode = 1;
    }),
});
