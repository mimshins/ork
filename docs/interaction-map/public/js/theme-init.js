/**
 * @file Applies the theme before the page paints, so it never flashes:
 *   `?theme=light|dark` first, then the viewer's last choice. Loaded as a
 *   classic, blocking script in <head>.
 */
(function () {
  var t = new URLSearchParams(location.search).get("theme");
  if (t !== "light" && t !== "dark") {
    try {
      t = localStorage.getItem("se-map-theme");
    } catch (e) {
      t = null;
    }
  }
  if (t === "light" || t === "dark")
    document.documentElement.setAttribute("data-theme", t);
})();
