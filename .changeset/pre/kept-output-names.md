---
"@krapht/ork": patch
---

A `before:` or `verify:` step's long output is kept in a file named for the step
and its try (`review.1.verify-2.stdout.txt`, `review.1.verify-2.txt`), so a
later try no longer overwrites the file a session was pointed at.
