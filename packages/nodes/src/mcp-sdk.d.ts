/**
 * @file The MCP SDK's HTTP client as this project needs it. The SDK's own
 *   declaration of it does not fit `exactOptionalPropertyTypes`, so a transport
 *   typed by it can't be handed to the SDK's own client (C8). This gives it the
 *   SDK's `Transport` as its type, which is what the class implements.
 */

// oxlint-disable typescript/consistent-type-imports -- an import at the top would make this file a module, and this an augmentation that can't replace a declaration
declare module "@modelcontextprotocol/sdk/client/streamableHttp.js" {
  export const StreamableHTTPClientTransport: new (
    url: URL,
    options?: { requestInit?: RequestInit },
  ) => import("@modelcontextprotocol/sdk/shared/transport.js").Transport;
}
