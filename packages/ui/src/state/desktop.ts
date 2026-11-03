/**
 * @file Desktop notifications, which are opt-in: the browser asks first, and
 *   one is sent only while the page is not being looked at, since the page says
 *   the same thing otherwise. Some browsers have none, and that is not an
 *   error.
 */

export type DesktopAnswer = "granted" | "denied" | "unsupported";

const hasNotifications = (): boolean => "Notification" in globalThis;

/** Asks the browser, on the user's own press. */
export const askForDesktop = async (): Promise<DesktopAnswer> => {
  if (!hasNotifications()) return "unsupported";
  const answer = await Notification.requestPermission();
  return answer === "granted" ? "granted" : "denied";
};

export const showOnDesktop = (
  title: string,
  tag: string,
  onClick: () => void,
): void => {
  if (
    !hasNotifications() ||
    Notification.permission !== "granted" ||
    document.visibilityState === "visible"
  ) {
    return;
  }
  const shown = new Notification("Ork", { body: title, tag });
  shown.addEventListener("click", () => {
    window.focus();
    onClick();
    shown.close();
  });
};
