/**
 * @file The gallery's section of what floats and what chooses: menus, popovers,
 *   dialogs, toasts, tabs, selects and comboboxes, each with its trigger.
 */

import { useState } from "react";

import { Button } from "../components/button.tsx";
import { Combobox } from "../components/combobox.tsx";
import { ConfirmDialog, Dialog } from "../components/dialog.tsx";
import { Menu } from "../components/menu.tsx";
import { Popover } from "../components/popover.tsx";
import { Select } from "../components/select.tsx";
import { Tabs } from "../components/tabs.tsx";
import { Toasts, toasts } from "../components/toast.tsx";

import styles from "./gallery.module.css";

const DRIVERS = [
  { value: "cli", label: "claude CLI" },
  { value: "sdk", label: "Agent SDK" },
];

const noop = () => {
  toasts.add({ title: "Selected." });
};

export const Overlays = () => {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [driver, setDriver] = useState("cli");
  const [workflow, setWorkflow] = useState<string | null>(null);
  return (
    <Toasts>
      <section className={styles["section"]}>
        <h2 className={styles["heading"]}>Overlays</h2>
        <div className={styles["row"]}>
          <Menu
            entries={[
              { label: "Reset layout", onSelect: noop },
              { label: "Show logs", onSelect: noop, hint: "L" },
              "separator",
              { label: "Disabled", onSelect: noop, disabled: true },
              { label: "Stop run", onSelect: noop, danger: true },
            ]}
            trigger={<Button>Window</Button>}
          />
          <Popover
            title="Budget"
            trigger={<Button>Budget</Button>}
          >
            <p>$1.42 of $2.00</p>
          </Popover>
          <Button
            onClick={() => {
              setDialog(true);
            }}
          >
            Run workflow…
          </Button>
          <Button
            onClick={() => {
              setConfirm(true);
            }}
            variant="danger"
          >
            Stop run…
          </Button>
          <Button
            onClick={() => {
              toasts.add({
                title: "build failed",
                description: "exit 1. Its logs say why.",
              });
            }}
          >
            Toast
          </Button>
        </div>
      </section>
      <section className={styles["section"]}>
        <h2 className={styles["heading"]}>Choosers</h2>
        <div className={styles["row"]}>
          <Select
            label="Driver"
            onChange={setDriver}
            options={DRIVERS}
            value={driver}
          />
          <Combobox
            empty="No workflow matches."
            label="Workflow"
            onChange={setWorkflow}
            options={[
              { value: "software-factory", label: "software-factory" },
              { value: "pr-review", label: "pr-review" },
            ]}
            placeholder="Type to filter"
            value={workflow}
          />
        </div>
        <Tabs
          label="Run details"
          tabs={[
            { id: "graph", label: "Graph", panel: <p>The graph</p> },
            { id: "tree", label: "Tree", panel: <p>The tree</p> },
          ]}
        />
      </section>
      <Dialog
        description="Runs in this project."
        onOpenChange={setDialog}
        open={dialog}
        title="Run workflow"
      >
        <Button
          onClick={() => {
            setDialog(false);
          }}
          variant="primary"
        >
          Run
        </Button>
      </Dialog>
      <ConfirmDialog
        cli="ork stop 4f2a1c"
        confirm="Stop run"
        description="Running nodes are interrupted. It can be resumed later from a terminal."
        onConfirm={noop}
        onOpenChange={setConfirm}
        open={confirm}
        title="Stop run 4f2a1c?"
      />
    </Toasts>
  );
};
