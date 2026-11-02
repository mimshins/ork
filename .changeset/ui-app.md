---
"@krapht/ork": minor
---

`ork ui` now serves Ork's browser app, bundled inside the package and loaded
only from your machine (no CDNs, no remote fonts). This first cut only shows
which Ork serves it; the panels follow. The page runs under a strict content
security policy, and the licenses of the third-party code it bundles are in
`dist/ui/THIRD_PARTY_LICENSES.txt`.
