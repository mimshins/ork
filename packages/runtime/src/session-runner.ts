/**
 * @file The session runner: one agent CLI session, driven through an adapter's
 *   strategies (`adapter.ts`), written once for every driver. It serves Ork's
 *   tools on a local MCP endpoint, wires the session to it, and runs the tool
 *   as one or more processes (legs). A paused node's tool call is held, and
 *   past the hold window deferred; the next leg resumes the session once the
 *   node continues (ADR-041). A tool that takes no message mid-session gets one
 *   at the next leg, which resumes the session with it. A driver that cannot
 *   hold the final answer to the report schema gets Ork's `report` tool, and
 *   the session ends with the report it accepted. Interrupting stops the
 *   running process.
 */

import { homedir } from "node:os";
import path from "node:path";

import type {
  AgentRuntime,
  NodeReport,
  RuntimeEvent,
  Session,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

import type { CliAdapter, OrkEndpoint, Wired } from "./adapter.ts";
import { holdAtTool } from "./hold.ts";
import { startOrkMcpHttp } from "./mcp-http.ts";
import { driverFailure, type EndScope, failureKind } from "./session-end.ts";
import { type LegInput, runLeg } from "./session-leg.ts";
import { orkTools, preapprovedTools } from "./tools/registry.ts";
import { REPORT_TOOL } from "./tools/report.ts";

export type RunnerOptions = {
  /** The program to run; defaults to the adapter's, on the PATH. */
  bin?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** How long a held call waits before it defers (tests shorten it). */
  holdWindowMs?: number;
  /** The project's runs folder: a `lease` wiring keeps its ledger there. */
  runs?: string;
};

/**
 * What a session's end is written with: the node's limits and program, and its
 * folder and the home folder taken out of the detail.
 */
const scopeOf = (
  spec: SessionSpec,
  bin: string,
  env: Readonly<Record<string, string | undefined>>,
): EndScope => ({
  facts: {
    ...(spec.maxTurns === undefined ? {} : { maxTurns: spec.maxTurns }),
    ...(spec.budgetUsd === undefined ? {} : { budgetUsd: spec.budgetUsd }),
    program: path.basename(bin),
  },
  scrub: { roots: [spec.cwd], home: env["HOME"] ?? homedir() },
});

/** A spec that resumes `sessionId`; a fork's later legs continue the fork. */
const resumed = (spec: SessionSpec, sessionId: string): SessionSpec => ({
  ...spec,
  resume: sessionId,
  fork: false,
});

/**
 * Wires a session to Ork's endpoint, yielding a `session.waiting` event each
 * time the wiring says it waits (a lease waits for its checkout).
 */
const wireSaying = async function* (
  adapter: CliAdapter,
  spec: SessionSpec,
  endpoint: OrkEndpoint,
  signal: AbortSignal,
  options: RunnerOptions,
): AsyncGenerator<RuntimeEvent, Wired> {
  const waits: string[] = [];
  let woke: (() => void) | undefined;
  const woken = (): Promise<false> =>
    new Promise(resolve => {
      woke = () => {
        resolve(false);
      };
    });
  const wiring = adapter.mcp.wire(spec, endpoint, {
    waiting: reason => {
      waits.push(reason);
      woke?.();
    },
    signal,
    bin: options.bin ?? adapter.command.bin,
    env: options.env ?? process.env,
    ...(options.runs === undefined ? {} : { runs: options.runs }),
  });
  const done = wiring.then(
    () => true,
    () => true,
  );
  for (;;) {
    const finished =
      waits.length === 0 &&
      // oxlint-disable-next-line eslint/no-await-in-loop -- one wait at a time
      (await Promise.race([done, woken()]));
    for (const reason of waits.splice(0)) {
      yield { type: "session.waiting", reason };
    }
    if (finished) return wiring;
  }
};

/**
 * A runtime that drives `adapter`'s tool, as the user installed and logged it
 * in. Ork never reads or passes its credentials.
 */
export const createSessionRuntime = (
  adapter: CliAdapter,
  options: RunnerOptions = {},
): AgentRuntime => ({
  driver: adapter.driver,
  start: (spec, ports): Session => {
    const { input } = adapter.command;
    // Lines for stdin, written once a process is up.
    const pending: string[] =
      input === undefined ? [] : [input(spec.prompt, false)];
    // Messages for a tool with no stdin: the next leg brings them.
    const queued: string[] = [];
    let io: { write: (line: string) => void; stop: () => void } | undefined;
    const ended = new AbortController();
    /** The hold hook deferred a call in the running process. */
    let deferring = false;
    /** The last report the `report` tool accepted, across legs. */
    let reported: NodeReport | null = null;
    const { hold } = ports;
    const hook = hold === undefined ? undefined : adapter.hold;
    const bin = options.bin ?? adapter.command.bin;
    const scope = scopeOf(spec, bin, options.env ?? process.env);

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      const tools = orkTools({
        nodeId: spec.nodeId,
        driver: adapter.driver,
        ports,
        report: {
          schema: spec.reportSchema,
          submit: report => {
            reported = report;
          },
        },
      });
      // The tool is offered only where the driver cannot check the report.
      const byTool = tools.some(tool => tool.name === REPORT_TOOL);
      const mcp = await startOrkMcpHttp(
        tools,
        hold === undefined || hook === undefined
          ? undefined
          : async gone => {
              const answer = await holdAtTool(
                hold,
                AbortSignal.any([gone, ended.signal]),
                options.holdWindowMs ?? hook.windowMs,
              );
              if (answer === "defer") deferring = true;
              return hook.answer(answer);
            },
      );
      const endpoint: OrkEndpoint =
        hook === undefined ? { url: mcp.url, token: mcp.token } : mcp;
      const allowed = preapprovedTools(tools);
      let wired: Wired | undefined;
      try {
        try {
          wired = yield* wireSaying(
            adapter,
            spec,
            endpoint,
            ended.signal,
            options,
          );
        } catch (error) {
          yield driverFailure(
            `could not reach Ork's tools: ${error instanceof Error ? error.message : String(error)}`,
            failureKind(error),
            scope,
          );
          return;
        }
        // OpenCode takes its folder from PWD, which a spawn's cwd leaves as is.
        const env = {
          ...(options.env ?? process.env),
          PWD: spec.cwd,
          ...adapter.context.env(spec),
          ...wired.env,
        };
        const legOf = (
          legSpec: SessionSpec,
          carried: SessionUsage | undefined,
        ): LegInput => ({
          adapter,
          bin,
          env,
          scope,
          cwd: spec.cwd,
          args: [
            ...adapter.command.args(legSpec, { endpoint, allowed }),
            ...(wired?.args ?? []),
          ],
          carried,
          ...(adapter.legDecoder === undefined
            ? {}
            : { decoder: adapter.legDecoder(legSpec) }),
          pending,
          deferred: () => deferring,
          withhold: () => input === undefined && queued.length > 0,
          ...(byTool ? { reported: () => reported } : {}),
          attach: attached => {
            io = attached;
          },
        });
        let legSpec = spec;
        let spent: SessionUsage | undefined;
        for (;;) {
          // Interrupted while wiring (no process yet to stop) or between legs.
          if (ended.signal.aborted) {
            yield driverFailure("interrupted", "interrupted", scope);
            return;
          }
          const leg = yield* runLeg(legOf(legSpec, spent));
          if (leg.kind === "failed") {
            yield driverFailure(leg.reason, leg.end, scope);
            return;
          }
          if (leg.kind === "finished") return;
          deferring = false;
          spent =
            spent === undefined
              ? leg.usage
              : adapter.usage.combine(spent, leg.usage);
          if (leg.kind === "deferred") {
            // Wait for the node to continue, then resume the session with no
            // new message; the pending call's hook then lets it run.
            // oxlint-disable-next-line eslint/no-await-in-loop -- one leg at a time
            await hold?.wait("tool", ended.signal);
          }
          if (ended.signal.aborted) {
            yield leg.last;
            return;
          }
          legSpec =
            leg.kind === "continued"
              ? {
                  ...resumed(spec, leg.sessionId),
                  prompt: queued.splice(0).join("\n\n"),
                }
              : resumed(spec, leg.sessionId);
        }
      } finally {
        await wired?.release();
        await mcp.close();
      }
    };

    return {
      events: events(),
      send: text => {
        if (input === undefined) {
          queued.push(text);
          return;
        }
        const line = input(text, true);
        if (io === undefined) pending.push(line);
        else io.write(line);
      },
      interrupt: () => {
        ended.abort();
        io?.stop();
        return Promise.resolve();
      },
    };
  },
});
