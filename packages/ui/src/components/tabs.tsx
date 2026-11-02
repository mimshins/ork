/**
 * @file Tabs, on Base UI's: a labeled list of tabs and the panel of the active
 *   one, with the arrow keys moving between them.
 */

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

import styles from "./tabs.module.css";

export type Tab = { id: string; label: string; panel: ReactNode };

export type TabsProps = {
  /** What the tabs choose between, for screen readers. */
  label: string;
  tabs: readonly Tab[];
  /** The tab shown first; the first one by default. */
  initial?: string;
};

export const Tabs = ({ label, tabs, initial }: TabsProps) => (
  <BaseTabs.Root defaultValue={initial ?? tabs[0]?.id ?? null}>
    <BaseTabs.List
      aria-label={label}
      className={styles["list"]}
    >
      {tabs.map(tab => (
        <BaseTabs.Tab
          className={styles["tab"]}
          key={tab.id}
          value={tab.id}
        >
          {tab.label}
        </BaseTabs.Tab>
      ))}
    </BaseTabs.List>
    {tabs.map(tab => (
      <BaseTabs.Panel
        className={styles["panel"]}
        key={tab.id}
        value={tab.id}
      >
        {tab.panel}
      </BaseTabs.Panel>
    ))}
  </BaseTabs.Root>
);
