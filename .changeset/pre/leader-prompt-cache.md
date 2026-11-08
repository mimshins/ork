---
"@krapht/ork": patch
---

Leaders run with the one-hour prompt cache (`ENABLE_PROMPT_CACHING_1H=1`) on
both drivers, as the context spec says, so a leader waiting on its children
keeps its cached prefix.
