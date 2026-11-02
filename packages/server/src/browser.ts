/**
 * @file The browser entry of `@krapht/ork-server`
 *   (`@krapht/ork-server/client`): only the API contract and the typed client,
 *   which import nothing from Node, so the UI's bundle can use them.
 */

export * from "./client.ts";
export * from "./contract.ts";
