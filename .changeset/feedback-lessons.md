---
"@krapht/ork": minor
---

`ork feedback accept <item> --lesson` turns a feedback item into a lesson: one
line in `.ork/lessons/<workflow>.md` of the project it came from, which every
later session of that workflow reads. `-m` gives its words. A workflow's lessons
are held to 1,500 tokens: accepting past that is refused, and a longer file is
cut, which `ork context explain` and the Context panel say.
