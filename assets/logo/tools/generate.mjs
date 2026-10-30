/**
 * @file Generates Ork's logo set (drawn in draw.mjs): the SVG mark, its
 *   transparent version and the wordmark, then the favicon and device icons.
 *   PNGs are rendered by the Google Chrome already on the machine (headless, no
 *   npm dependency), and `favicon.ico` packs the 16, 32 and 48 px PNGs. Run it
 *   from anywhere: `node assets/logo/tools/generate.mjs` (set `CHROME` to
 *   another Chrome or Chromium binary if needed).
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  C,
  favicon,
  markOnScreen,
  markTransparent,
  wordmark,
} from "./draw.mjs";

const LOGO = path.resolve(import.meta.dirname, "..");
const ICONS = path.join(LOGO, "icons");
const MAP_PUBLIC = path.resolve(LOGO, "../../docs/interaction-map/public");
const CHROME =
  process.env["CHROME"] ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Renders `svgText` to a `size`×`size` PNG with the machine's Chrome.
 *
 * @param {string} svgText
 * @param {number} size
 * @param {string} out
 * @param {string} background CSS colour behind the image.
 */
const rasterize = (svgText, size, out, background = "transparent") => {
  const work = mkdtempSync(path.join(tmpdir(), "ork-logo-"));
  try {
    writeFileSync(path.join(work, "icon.svg"), svgText);
    writeFileSync(
      path.join(work, "page.html"),
      `<!doctype html><html><body style="margin:0;background:${background}"><img src="icon.svg" width="${String(size)}" height="${String(size)}" style="display:block"></body></html>`,
    );
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        `--window-size=${String(size)},${String(size)}`,
        `--screenshot=${out}`,
        `file://${path.join(work, "page.html")}`,
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/**
 * Packs PNGs into one `.ico` with PNG entries, which current browsers read.
 *
 * @param {{ size: number; data: Buffer }[]} pngs
 * @param {string} out
 */
const packIco = (pngs, out) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  writeFileSync(
    out,
    Buffer.concat([header, ...entries, ...pngs.map(p => p.data)]),
  );
};

const MANIFEST = {
  name: "Ork",
  short_name: "Ork",
  description: "Orchestrate Claude agents on your machine",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  theme_color: C.screen,
  background_color: C.screen,
  display: "standalone",
};

/** The favicon at 16, 32 and 48 px: whole multiples, so every pixel is crisp. */
const writeIco = () => {
  const work = mkdtempSync(path.join(tmpdir(), "ork-ico-"));
  try {
    const pngs = [16, 32, 48].map(size => {
      const file = path.join(work, `${String(size)}.png`);
      rasterize(favicon(), size, file);
      return { size, data: readFileSync(file) };
    });
    packIco(pngs, path.join(ICONS, "favicon.ico"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

const main = () => {
  mkdirSync(ICONS, { recursive: true });
  writeFileSync(
    path.join(LOGO, "ork-mark.svg"),
    markOnScreen({ size: ' width="256" height="256"' }),
  );
  writeFileSync(path.join(LOGO, "ork-mark-transparent.svg"), markTransparent());
  writeFileSync(path.join(LOGO, "ork-wordmark.svg"), wordmark());
  writeFileSync(path.join(ICONS, "favicon.svg"), favicon());
  writeIco();

  // iOS rounds a solid square itself; keep the mark well inside it.
  rasterize(
    markOnScreen({ bleed: true, scale: 0.84 }),
    180,
    path.join(ICONS, "apple-touch-icon.png"),
    C.screen,
  );
  rasterize(markOnScreen(), 192, path.join(ICONS, "icon-192.png"));
  rasterize(markOnScreen(), 512, path.join(ICONS, "icon-512.png"));
  // Maskable: the mark inside the central 80% circle (radius 25.6 of 64).
  rasterize(
    markOnScreen({ bleed: true, scale: 0.76 }),
    512,
    path.join(ICONS, "icon-maskable-512.png"),
    C.screen,
  );
  writeFileSync(
    path.join(ICONS, "site.webmanifest"),
    `${JSON.stringify(MANIFEST, undefined, 2)}\n`,
  );

  // The interaction map serves only its public/ folder: give it copies.
  for (const file of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
    copyFileSync(path.join(ICONS, file), path.join(MAP_PUBLIC, file));
  }
  process.stdout.write(`✓ Wrote the logo set to ${LOGO}\n`);
};

main();
