/**
 * @file The design system's gallery: every component in its states on one page,
 *   with the theme under the page's control. It is a tool for looking, never
 *   part of the app: `pnpm ui:dev` serves it at `/gallery.html`, and `vite
 *   build --mode gallery` builds it alone, so it can be checked under the
 *   page's content security policy.
 */

import { CSPProvider } from "@base-ui/react/csp-provider";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "../components/button.tsx";
import { TipProvider } from "../components/tip.tsx";
import { followSystem, type ThemeChoice } from "../design/theme.ts";
import { Section } from "./section.tsx";
import { Sections } from "./sections.tsx";

import "../design/design.css";
import styles from "./gallery.module.css";

const THEMES: ThemeChoice[] = ["system", "dark", "light"];

const Gallery = () => {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  useEffect(() => followSystem(window, () => theme), [theme]);
  return (
    <main className={styles["page"]}>
      <h1 className={styles["title"]}>Ork design system</h1>
      <Section title="Theme">
        {THEMES.map(choice => (
          <Button
            key={choice}
            onClick={() => {
              setTheme(choice);
            }}
            variant={choice === theme ? "primary" : "default"}
          >
            {choice}
          </Button>
        ))}
      </Section>
      <Sections />
    </main>
  );
};

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <CSPProvider disableStyleElements>
        <TipProvider>
          <Gallery />
        </TipProvider>
      </CSPProvider>
    </StrictMode>,
  );
}
