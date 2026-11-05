---
"@krapht/ork": patch
---

Fix what `ork validate` got wrong. `when.value` no longer stops a condition that
can hold, such as `status == 'fail'` on a node with its own list of statuses, or
a value a loop brings back to a router. A declared `status` a session can't
report is now an error. Walking a workflow says a node never runs in fewer cases
where it can, and stops at its time limit even inside one path. A failed node's
output no longer holds values it didn't declare.
