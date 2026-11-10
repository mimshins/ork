/**
 * @file @modelcontextprotocol/sdk's transport types name the DOM's
 *   `HeadersInit`. Ork compiles without the DOM lib, so this declares only that
 *   one name, from Node's own `Headers`.
 */

type HeadersInit = ConstructorParameters<typeof Headers>[0];
