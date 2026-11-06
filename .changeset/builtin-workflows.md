---
"@krapht/ork": minor
---

`ork run`, `ork validate` and `ork context explain` take Ork's own workflows by
an `ork:` name. The first is `ork:feedback-apply`, which proposes a fix for a
feedback item on a branch and asks whether to keep it. Ork writes a built-in
into the project's run folder (`.ork/runs/.builtin/`), so its runs belong to the
project and resume from the text they started with.
