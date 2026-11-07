# ADR-040 — The UI's stack: React, Base UI, dockview, containerized-state, our own graph

- **Status:** Accepted
- **Date:** 2026-11-02
- **Topic:** UI / dependencies / security
- **RFC:** waived. The author chose these options over the others below.
- **Builds on:** [ADR-039](./ADR-039-local-server.md) (the local server, its
  contract and its typed client)

## Context

M2 puts a browser UI on top of the local server. Ork's users are engineers at
their own machine. The author asked for:

- a Figma-like, futuristic feel, with the logo's amber and phosphor as the
  primary and secondary colors;
- accessibility and readability above all;
- Photoshop-style panels that can be resized, minimized and docked;
- a notification center;
- pause, continue and stop for a run or one of its nodes.

This is Ork's first browser code. Because `@krapht/ork` is the only published
package, the UI has to reach users inside it.

## Decision

- **`packages/ui` (`@krapht/ork-ui`, private)** is a React 19 app built with
  Vite 8.
  - Its build (`dist/`: `index.html`, hashed `assets/`, and
    `THIRD_PARTY_LICENSES.txt`) is copied into the CLI's `dist/ui` by the CLI's
    build. The server serves it. Without the built folder, the placeholder page
    is served instead.
  - The CLI takes the UI's built files, not its source.
  - The dependency direction becomes
    `integrations <- schema <- core <- runtime-claude, nodes <- server <- ui, cli`.
- **Browser code imports only `@krapht/ork-server/client`.** This is a second
  entry of the server, a module that only re-exports the contract and the typed
  client. Lint refuses `node:*` and every other Ork package in
  `packages/ui/src`.
- **State: containerized-state** (`containerized-state`,
  `react-containerized-state`, `containerized-state-plugin-persistence`), the
  author's library.
  - There is one container per concern.
  - The server's event streams feed the containers.
  - The layout, preferences and notification read state persist in
    `localStorage`.
  - There is no TanStack Query: the streams push the state, so a cache of
    requests has nothing left to do.
- **Accessible components: Base UI** (`@base-ui/react`), unstyled, and styled on
  Ork's design tokens.
- **Panels: dockview** (`dockview-react`): split, tab, dock, float, minimize and
  maximize, with a layout that is saved and restored. It is themed from the
  tokens.
- **The run graph is drawn in-house** (SVG, with a layered layout). React Flow
  was the obvious choice, but it keeps its state in zustand, and the author
  wants none in the bundle. If the in-house layout falls short on real
  workflows, `@dagrejs/dagre` (layout only) is the fallback.
- **Fonts: Geist and Geist Mono** (OFL), bundled through `@fontsource`. No
  remote fonts are loaded.
- **Tests:** vitest's `ui` project runs in jsdom, with `@testing-library/react`
  and `axe-core`; every component test checks for serious and critical axe
  violations. happy-dom was tried first, but its type definitions need a newer
  `@types/node` than the repository can use.
- **Lint:** oxlint's `react` and `jsx-a11y` plugins are turned on for
  `packages/ui` only.
- **The content security policy for the page:**

  ```
  default-src 'self'; script-src 'self'; style-src 'self';
  style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:;
  connect-src 'self'; frame-ancestors 'none'; base-uri 'none';
  form-action 'self'; object-src 'none'
  ```

  There is no inline script and no inline `<style>`. zod runs without compiled
  parsers in the browser (`config({ jitless: true })`, set before the contract
  is imported), because its probe for them calls `Function`, which the policy
  counts as `eval`. Base UI's style elements are switched off
  (`CSPProvider disableStyleElements`), and the design system's style sheets
  carry those styles instead. Inline `style` attributes are allowed, because the
  panels, popups and graph position themselves with them.

- **Development:** `pnpm ui:dev` runs Vite's dev server on `127.0.0.1:5173`,
  which proxies `/api` to the running `ork ui`. The proxy signs each request
  with the token from `~/.ork/ui.json` and drops the dev server's Origin. The
  token never reaches the browser, and the server's guards are unchanged.

## Options considered

- **State:**
  - zustand: small and popular, but the author asked for containerized-state;
  - Jotai;
  - TanStack Query plus React context.
- **Accessible base:**
  - React Aria Components: the strongest accessibility, but a large surface;
  - Radix Primitives: development has slowed, and it has fewer components;
  - in-house: the highest risk to accessibility.
- **Panels:**
  - react-resizable-panels plus our own tabs and docking: no floating panels or
    drag-to-dock unless we build them;
  - fully in-house.
- **Graph:**
  - React Flow (`@xyflow/react`): brings zustand;
  - another graph library;
  - in-house: chosen.
- **Fonts:**
  - Inter with JetBrains Mono;
  - the system sans with one bundled mono.
- **Shipping:**
  - publish `@krapht/ork-ui` as its own package: two packages to version and
    install;
  - build at install time: no lifecycle scripts are allowed;
  - bundled in the CLI: chosen.

## Rationale

- Ork runs offline on the user's machine, so everything ships inside the one
  package and loads from the server itself.
- Base UI and dockview give accessible behavior and pro-tool panels without
  imposing a look, so the design system stays Ork's own.
- An in-house graph keeps one state model through the whole UI, and gives the
  designer slice a canvas it controls.
- Using containerized-state in a demanding UI — many subscribers, high-rate
  events — tests the library hard, which its author asked for.

## Consequences

- The CLI's tarball grows by the UI bundle: about 100 KB gzipped today, before
  the panels and fonts. Commands other than `ork ui` don't load it.
- The CLI ships third-party browser code. `THIRD_PARTY_LICENSES.txt` is
  generated from what the bundle actually contains (a Vite plugin), and
  `THIRD_PARTY_NOTICES.md` points to it.
- Each new UI dependency follows the 7-day rule and gets checked against the
  CSP. A library that needs inline `<style>` or `eval` is ruled out or
  configured around.
- Browser end-to-end tests (Playwright) are not in CI yet. Until then, a UI
  slice is checked by hand in a browser ([C6](../specs/ui/limits.md)).
