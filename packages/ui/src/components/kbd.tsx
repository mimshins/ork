/**
 * @file The key hint: one key combination, one `<kbd>` per key. Apart from the
 *   empty state, though they share a sheet, since a tooltip shows keys and the
 *   empty state's command block holds a button with a tooltip.
 */

import styles from "./bits.module.css";

/** One key combination, one `<kbd>` per key: `<Kbd keys={["⌘", "K"]} />`. */
export const Kbd = ({ keys }: { keys: readonly string[] }) => (
  <span className={styles["keys"]}>
    {keys.map(key => (
      <kbd
        className={styles["key"]}
        key={key}
      >
        {key}
      </kbd>
    ))}
  </span>
);
