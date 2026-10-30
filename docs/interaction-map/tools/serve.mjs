/**
 * @file Serves the interaction map on localhost, with no dependencies: `pnpm
 *   map` (or `pnpm map -- --port 9000`), then open the printed URL. ES modules
 *   do not load from `file://`, so the map needs a server.
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const PUBLIC = join(import.meta.dirname, "..", "public");
const flag = process.argv.indexOf("--port");
const PORT = Number(
  flag === -1 ? (process.env["PORT"] ?? 8791) : process.argv[flag + 1],
);

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/**
 * The file a request path maps to, or `null` when it would leave `public/`.
 *
 * @param {string} url The request URL.
 * @returns {string | null} The file's path.
 */
const fileFor = url => {
  const path = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const file = normalize(
    join(PUBLIC, path.endsWith("/") ? `${path}index.html` : path),
  );
  return file === PUBLIC || file.startsWith(PUBLIC + sep) ? file : null;
};

const server = createServer((req, res) => {
  const file = fileFor(req.url ?? "/");
  let isFile = false;
  try {
    isFile = file !== null && statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (file === null || !isFile) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Interaction map: http://localhost:${PORT}/`);
});
