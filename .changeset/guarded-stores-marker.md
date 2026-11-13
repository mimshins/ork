---
"@krapht/ork": patch
---

`ork ui` and `ork decide` now work under a different store than the run that
started the process: sessions and programs carry `ORK_GUARDED_STORES`, the
stores their runs guard, and the commands that act as the user refuse only in
those. A nested run adds its store to the list, and a marker with no list still
refuses everywhere.
