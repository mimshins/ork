/**
 * @file A `--import` preload that lowers the global `fetch`'s headers timeout
 *   (undici's, 300 s by default) to `SHORT_FETCH_TIMEOUT_MS`, so a test can
 *   show in a second what a five-minute ask does to a process that posts
 *   through `fetch`. Node does not export undici's `Agent`, so it takes the
 *   class from the global dispatcher, which the first `fetch` creates.
 */

const key = Symbol.for("undici.globalDispatcher.1");
await fetch("http://127.0.0.1:1/").catch(() => undefined);
const Agent = globalThis[key].constructor;
globalThis[key] = new Agent({ headersTimeout: Number(process.env.SHORT_FETCH_TIMEOUT_MS) });
