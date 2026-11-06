/**
 * @file The Feedback panel: what got in the runs' way, grouped into items, and
 *   what a person does with one, the UI twin of `ork feedback list | show |
 *   dismiss | restore | accept | apply | publish | split`. A wide panel shows
 *   the list beside the chosen item; a narrow one shows one in the other's
 *   place. Choosing an item is the person's act, never done for them.
 */

import { ItemDetail } from "./feedback-detail.tsx";
import { BackToItems } from "./feedback-facts.tsx";
import { FeedbackList } from "./feedback-list.tsx";
import { short } from "./feedback-model.ts";
import { FeedbackTools, NoItems, ReadFailed } from "./feedback-tools.tsx";
import { useFeedbackPanel } from "./use-feedback-panel.ts";

import styles from "./feedback.module.css";

type View = ReturnType<typeof useFeedbackPanel>;

const ListCard = ({ view }: { view: View }) => {
  const { read, all, items, shown, filter, chosen } = view;
  return (
    <div
      aria-label="Items"
      className={styles["card"]}
      data-feedback-list=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus lands when the list empties, not a form's fieldset
      role="group"
      tabIndex={-1}
    >
      {read.status === "failed" ? <ReadFailed error={read.error} /> : null}
      {all === null && read.status !== "failed" ? (
        <p className={styles["message"]}>Reading feedback…</p>
      ) : null}
      {all !== null && shown.length === 0 ? (
        <NoItems
          anything={items.length > 0}
          filter={filter}
        />
      ) : null}
      {shown.length === 0 ? null : (
        <FeedbackList
          chosen={chosen}
          items={shown}
          onChoose={view.choose}
        />
      )}
    </div>
  );
};

const DetailCard = ({ view }: { view: View }) => {
  const { item, chosen, narrow } = view;
  return (
    <div
      className={styles["card"]}
      data-feedback-detail=""
    >
      {item === undefined ? null : (
        <ItemDetail
          acts={view.acts}
          item={item}
          narrow={narrow}
          onBack={view.back}
          onLeave={view.back}
          read={view.detail}
        />
      )}
      {item === undefined && narrow && chosen !== null ? (
        <>
          <BackToItems onBack={view.back} />
          <p className={styles["message"]}>
            {`${short(chosen)} isn't in this list any more.`}
          </p>
        </>
      ) : null}
      {item === undefined && !narrow ? (
        <p className={styles["message"]}>Choose an item to read its records.</p>
      ) : null}
    </div>
  );
};

export const FeedbackPanel = () => {
  const view = useFeedbackPanel();
  const { read, all, filter, shown, showing, focusWatch, root } = view;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- notes where the focus is
    <div
      aria-label="Feedback"
      className={styles["panel"]}
      data-layout={view.narrow ? "narrow" : "wide"}
      onBlur={focusWatch.onBlur}
      onFocus={focusWatch.onFocus}
      ref={root}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus can land, not a landmark: the dock names the panel
      role="group"
      tabIndex={-1}
    >
      <FeedbackTools
        count={shown.length}
        failed={read.status === "failed"}
        filter={filter}
        items={all}
        onFilter={view.setFilter}
        onReload={view.reload}
        updating={read.status === "loading" && all !== null}
      />
      <div className={styles["body"]}>
        {showing === "detail" ? null : <ListCard view={view} />}
        {showing === "list" ? null : <DetailCard view={view} />}
      </div>
    </div>
  );
};
