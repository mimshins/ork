/**
 * @file The page the server shows until the UI is built (a later M2 slice): it
 *   says the server is up and lists the runs and open decisions live, through
 *   the overview stream. Its script is a separate file, so the page's content
 *   security policy allows no inline script.
 */

/** Where the placeholder's script is served. */
export const PLACEHOLDER_SCRIPT = "/placeholder.js";

export const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ork</title>
<style>
  :root { color-scheme: light dark; --fg: #1d1f23; --muted: #6b7079; --bg: #fbfbfa; --line: #e3e3e0; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e6e6e3; --muted: #9a9ea6; --bg: #16171a; --line: #2a2c31; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; }
  p, .muted { color: var(--muted); }
  ul { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }
  li { padding: 8px 0; border-bottom: 1px solid var(--line); font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<main>
  <h1>Ork</h1>
  <p id="status">The server is running. The UI's panels come in the next releases; until then, this page lists what the API sees.</p>
  <h2>Open decisions</h2>
  <ul id="decisions"><li class="muted">Loading…</li></ul>
  <h2>Runs</h2>
  <ul id="runs"><li class="muted">Loading…</li></ul>
  <p>Answer with <code>ork decide</code>; follow a run with <code>ork logs &lt;run&gt; -f</code>.</p>
</main>
<script src="${PLACEHOLDER_SCRIPT}"></script>
</body>
</html>
`;

export const PLACEHOLDER_JS = `"use strict";
const fill = (id, items, line, empty) => {
  const list = document.getElementById(id);
  list.replaceChildren();
  if (items.length === 0) items = [null];
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item === null ? empty : line(item);
    if (item === null) li.className = "muted";
    list.append(li);
  }
};
fetch("/api/health").then(r => r.json()).then(h => {
  document.title = "Ork " + h.version;
});
const events = new EventSource("/api/stream");
events.addEventListener("runs", e => fill("runs", JSON.parse(e.data),
  r => r.id + "  " + r.live.padEnd(9) + "  " + r.workflow + "  " + r.startedAt.slice(0, 16).replace("T", " "),
  "No runs yet."));
events.addEventListener("decisions", e => fill("decisions", JSON.parse(e.data),
  d => d.id + "  " + d.node + "  " + d.question + "  [" + d.options.map(o => o.id).join(", ") + "]",
  "None."));
events.onerror = () => {
  document.getElementById("status").textContent = "Lost the server; it may have stopped (start it with ork ui).";
};
`;
