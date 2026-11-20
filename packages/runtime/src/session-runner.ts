/**
 * @file The session runner: one agent CLI session, driven through an adapter's
 *   strategies (`adapter.ts`), written once for every driver. It serves Ork's
 *   tools on a local MCP endpoint, wires the session to it, and runs the tool
 *   as one or more processes (legs). A paused node's tool call is held, and
 *   past the hold window deferred; the next leg resumes the session once the
 *   node continues (ADR-041). A tool that takes no message mid-session gets one
 *   at the next leg, which resumes the session with it. A driver that cannot
 *   hold the final answer to the report schema gets Ork's `report` tool, and
 *   the session ends with the report it accepted. A tool that speaks frames
 *   both ways (`CliAdapter.protocol`, RFC-027) runs as duplex legs: a message
 *   is sent to the running process, its approval asks go to the human channel,
 *   and a deferred call ends the leg, resumed by its session id. Interrupting
 *   stops the running process, or ends a wait between legs; a stopped session
 *   is never resumed.
 */

import type {
  AgentRuntime,
  NodeReport,
  RuntimeEvent,
  Session,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

import type { CliAdapter, OrkEndpoint, Wired } from "./adapter.ts";
import { heavyHook, NEVER_HELD, toolHook } from "./heavy-hook.ts";
import { asStopped } from "./leg-step.ts";
import { startOrkMcpHttp } from "./mcp-http.ts";
import { driverFailure, failureKind, scopeOf } from "./session-end.ts";
import {
  legInputOf,
  type LegShared,
  runAnyLeg,
  wireSaying,
} from "./session-leg-input.ts";
import { sessionRules } from "./session-rules.ts";
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

/** A spec that resumes `sessionId`; a fork's later legs continue the fork. */
const resumed = (spec: SessionSpec, sessionId: string): SessionSpec => ({
  ...spec,
  resume: sessionId,
  fork: false,
});

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
    const { protocol } = adapter;
    // Lines for stdin, written once a process is up; a protocol leg's
    // messages, sent once its first requests are.
    const pending: string[] =
      input === undefined ? [] : [input(spec.prompt, false)];
    // Messages for a tool with no stdin: the next leg brings them.
    const queued: string[] = [];
    let io: { write: (line: string) => void; stop: () => void } | undefined;
    /** Ends a running protocol leg `deferred`. */
    let defer: (() => void) | undefined;
    const ended = new AbortController();
    /** The hold hook deferred a call in the running process. */
    let deferring = false;
    /** The last report the `report` tool accepted, across legs. */
    let reported: NodeReport | null = null;
    const { hold } = ports;
    // A shell read is refused in the hook, so a driver that can refuse there
    // gets it on every session that reads only through `extract` (RFC-025).
    const refuse = spec.reading === "open" ? undefined : adapter.hold?.refuse;
    const hook =
      hold === undefined && refuse === undefined ? undefined : adapter.hold;
    const heavy = heavyHook(ports.machine);
    // A stop or a timeout ends a wait for a slot, so a deferred call can't hold it.
    ended.signal.addEventListener(
      "abort",
      () => {
        heavy.release();
      },
      { once: true },
    );
    const bin = options.bin ?? adapter.command.bin;
    const scope = scopeOf(spec, bin, options.env ?? process.env);

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      const tools = orkTools({
        nodeId: spec.nodeId,
        driver: adapter.driver,
        ports,
        cwd: spec.cwd,
        ...sessionRules(spec),
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
        hook === undefined
          ? undefined
          : toolHook({
              hold: hold ?? NEVER_HELD,
              heavy,
              ...(refuse === undefined ? {} : { refuse }),
              ...(spec.reading === "extract-only" ? { textReads: true } : {}),
              answer: hook.answer,
              windowMs: options.holdWindowMs ?? hook.windowMs,
              ended: ended.signal,
              onDefer: () => {
                deferring = true;
                // A protocol tool keeps no call pending: its leg ends here.
                defer?.();
              },
            }),
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
        const shared: LegShared = {
          adapter,
          bin,
          env,
          scope,
          cwd: spec.cwd,
          ...(ports.machine === undefined
            ? {}
            : { priority: ports.machine.priority }),
          wiredArgs: wired.args,
          leg: { endpoint, allowed },
          human: ports.human,
          nodeId: spec.nodeId,
          pending,
          deferred: () => deferring,
          withhold: () => input === undefined && queued.length > 0,
          ...(byTool ? { reported: () => reported } : {}),
          attach: attached => {
            io = attached;
            defer = attached?.defer;
          },
        };
        let legSpec = spec;
        let spent: SessionUsage | undefined;
        /** The next leg resumes a session whose last leg was deferred. */
        let resumesDeferral = false;
        for (;;) {
          // Interrupted while wiring (no process yet to stop); one between
          // legs ends below, with the last leg's result.
          if (ended.signal.aborted) {
            yield driverFailure("interrupted", "interrupted", scope);
            return;
          }
          const legInput = legInputOf(shared, legSpec, spent, resumesDeferral);
          const leg = yield* runAnyLeg(legInput);
          if (leg.kind === "failed") {
            // A resumed leg stopped before it printed its start ran as before.
            const { spent: stopped } = leg;
            if (stopped?.sessionId === "") {
              stopped.sessionId = legSpec.resume ?? "";
            }
            yield driverFailure(leg.reason, leg.end, scope, stopped);
            return;
          }
          if (leg.kind === "finished") return;
          deferring = false;
          spent =
            spent === undefined
              ? leg.usage
              : adapter.usage.combine(spent, leg.usage);
          // A resumed leg stopped before it named its session ran as before.
          // A fork leg's `resume` is the source's id, not its own session.
          const sessionId =
            leg.sessionId ||
            (legSpec.fork === true ? "" : (legSpec.resume ?? ""));
          // A protocol session resumes only by its id; without one it can't.
          // A stop still ends it interrupted, below.
          if (
            protocol !== undefined &&
            sessionId === "" &&
            !ended.signal.aborted
          ) {
            yield driverFailure(
              `${adapter.command.bin} stopped before it named its session, so it cannot resume`,
              "driver_crashed",
              scope,
              { usage: spent, sessionId: "" },
            );
            return;
          }
          if (leg.kind === "deferred" && !ended.signal.aborted) {
            // Wait for the node to continue, then resume the session with no
            // new message (a protocol codec opens with its resume message);
            // the pending call's hook then lets it run.
            // A call deferred for a slot waits for it too, until a stop.
            // oxlint-disable-next-line eslint/no-await-in-loop -- one leg at a time
            await heavy.ready();
            // oxlint-disable-next-line eslint/no-await-in-loop -- one leg at a time
            await hold?.wait("tool", ended.signal);
          }
          // A stopped session is never resumed; a deferred one ends interrupted.
          if (ended.signal.aborted) {
            yield leg.kind === "deferred"
              ? asStopped(leg.last, legInput)
              : leg.last;
            return;
          }
          resumesDeferral = leg.kind === "deferred";
          legSpec =
            leg.kind === "continued"
              ? {
                  ...resumed(spec, sessionId),
                  prompt: queued.splice(0).join("\n\n"),
                }
              : resumed(spec, sessionId);
        }
      } finally {
        heavy.release();
        await wired?.release();
        await mcp.close();
      }
    };

    return {
      events: events(),
      send: text => {
        if (input === undefined && protocol === undefined) {
          queued.push(text);
          return;
        }
        const line = input === undefined ? text : input(text, true);
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
