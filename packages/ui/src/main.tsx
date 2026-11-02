/**
 * @file The UI's browser entry: loads the design system's style sheet, sets the
 *   page's look from the system (src/design/theme.ts), and mounts the app on
 *   `#root`. Two things the server's content security policy refuses are
 *   switched off first: zod's compiled parsers (it would probe with `Function`,
 *   which counts as `eval`; the app is imported only after), and Base UI's
 *   `<style>` elements, whose rules the design system's style sheets carry
 *   instead.
 */

import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config } from "zod";

import "./design/design.css";
import { followSystem } from "./design/theme.ts";

// Before any schema exists: zod probes for `Function` as it builds an object
// schema, and the contract builds its schemas when it is imported.
config({ jitless: true });
followSystem(window, () => "system");
const { App } = await import("./app/app.tsx");

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <CSPProvider disableStyleElements>
        <App />
      </CSPProvider>
    </StrictMode>,
  );
}
