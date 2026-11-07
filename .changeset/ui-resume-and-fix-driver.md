---
"@krapht/ork": minor
---

Resume a run from the browser view. A run that stopped, failed or crashed has a
**Resume…** button among its controls in the Monitor: it asks first, says it's a
paid run and what runs again, shows the `ork resume <run> --detach` command it
stands for, and picks the run up in the background with the inputs and flags it
started with. The Feedback panel's **Propose fix…** now offers a choice of
driver, as `ork feedback apply --driver` does, and its command follows it.
