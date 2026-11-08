---
"@krapht/ork": patch
---

`ork ui`: scrolling a panel past its end no longer carries the whole panel, its
header included, up the window. Every scroll area keeps its scrolling, and the
text only a screen reader reads, to itself.
