---
"@krapht/ork": patch
---

The browser view shows every command as a code block, never as inline code: a
full-width block with its copy button in the top-right corner, under a sentence
that ends in a colon. Empty states, a confirm dialog's command, the triggers'
next step and the Upgrade dialog's command all take one, and a control's tooltip
shows its command as a block line under its words. A copy button now sits only
in a block or a well, always in its corner, so "Copied." no longer pushes it
aside, and a feedback item's id is no longer copied from beside it.
