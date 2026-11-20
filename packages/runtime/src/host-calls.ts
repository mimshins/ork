/**
 * @file How a duplex leg answers the tool's calls of Ork's host tools
 *   (`LegContext.hostTools`, `DecodedFrame.call`): it finds the tool by the
 *   name the tool called it, runs it, and writes the codec's result frame with
 *   the call's id. Calls may overlap; each is answered on its own. A name Ork
 *   does not offer or a call that throws is answered with an error result
 *   carrying Ork's markers, as the MCP server's tools give; an answer that
 *   comes after the leg has ended is dropped.
 */

import type { Codec, Frame, HostCall, HostTool } from "./adapter.ts";
import {
  BAD_ARGUMENTS,
  ORK_FAILED,
  text,
  type ToolText,
} from "./tools/tool.ts";

const failure = (body: string): ToolText => ({ ...text(body), isError: true });

/** The result of one host tool call; never rejects. */
export const callHostTool = (
  tools: readonly HostTool[] | undefined,
  call: HostCall,
): Promise<ToolText> => {
  const tool = tools?.find(each => each.name === call.tool);
  if (tool === undefined) {
    return Promise.resolve(
      failure(`${BAD_ARGUMENTS}\nno Ork tool is named ${call.tool}`),
    );
  }
  return Promise.resolve()
    .then(() => tool.call(call.args))
    .catch((error: unknown) =>
      failure(
        `${ORK_FAILED}\n${error instanceof Error ? error.message : String(error)}`,
      ),
    );
};

/**
 * A leg's handler of host tool calls: each call's result is written with
 * `write` unless `ended` has aborted by then.
 */
export const hostCalls =
  (
    tools: readonly HostTool[] | undefined,
    codec: Codec,
    write: (frame: Frame) => void,
    ended: AbortSignal,
  ) =>
  (call: HostCall): void => {
    const answer = async () => {
      const result = await callHostTool(tools, call);
      if (!ended.aborted) write(codec.callResult(call, result));
    };
    void answer();
  };
