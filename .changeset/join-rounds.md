---
"@krapht/ork": patch
---

A run no longer ends succeeded when a join waited on a node that could never
run. In a later round of a loop, an edge whose source can't run any more (a
second builder the loop didn't go back to) counts as not taken, so the node it
fed is skipped and the join behind it fires, for `all` and `any` joins alike;
the run reaches its gate, or asks when the loop is out of rounds. A run that
still ends with a node waiting fails with an `ork engine error:` reason instead
of succeeding, and `ork validate` reports such a path as a bug in Ork rather
than as a way to succeed.
