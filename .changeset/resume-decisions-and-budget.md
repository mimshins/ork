---
"@krapht/ork": patch
---

Fix three resume and budget faults. A resumed run no longer reuses a stored
decision id, which handed the store's error to a session instead of its
question; what the last process left open is withdrawn and asked again. Results
kept across more than one resume now hold: a source that finished in an earlier
resume is not rerun, and items are never given results from an older list. The
run's budget now also counts what running sessions last reported, so nothing new
starts once that reaches the cap.
