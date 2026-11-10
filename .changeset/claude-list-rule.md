---
"@krapht/ork": patch
---

`ork validate` now refuses a Claude node's output field written as `list:` with
anything but a map of each item's fields (such as `list: string`), with the same
message tool nodes get, instead of the session failing when it starts.
