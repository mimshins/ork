/**
 * @file Vite configuration of the UI: the build `ork ui` serves (`dist/`, with
 *   hashed files under `assets/` and the bundled packages' licenses), and the
 *   dev server, which proxies `/api` to the running `ork ui`. The proxy signs
 *   each request with the token from `~/.ork/ui.json` and drops the dev
 *   server's Origin, so the token never reaches the browser and the server's
 *   guards stay as they are. In `gallery` mode it builds the design system's
 *   gallery instead, for looking at the components under the page's policy.
 */

import { readUiFile, uiFilePath } from "@krapht/ork-server";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

import { licenses } from "./build/licenses.ts";

/** The proxy to the running `ork ui`, or none when it is not running. */
const apiProxy = (): Record<string, ProxyOptions> => {
  const record = readUiFile(uiFilePath());
  if (record === null) return {};
  return {
    "/api": {
      target: `http://127.0.0.1:${String(record.port)}`,
      changeOrigin: true,
      headers: { authorization: `Bearer ${record.token}` },
      configure: proxy => {
        proxy.on("proxyReq", request => {
          request.removeHeader("origin");
          request.removeHeader("cookie");
        });
      },
    },
  };
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), licenses()],
  build: {
    outDir: mode === "gallery" ? "dist-gallery" : "dist",
    ...(mode === "gallery"
      ? { rolldownOptions: { input: { gallery: "gallery.html" } } }
      : {}),
    emptyOutDir: true,
    assetsDir: "assets",
    // Never as data: URLs: the page's policy takes fonts only from itself.
    assetsInlineLimit: 0,
    target: "es2024",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy(),
  },
}));
