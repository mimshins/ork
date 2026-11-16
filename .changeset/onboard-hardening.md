---
"@krapht/ork": patch
---

`ork onboard` is safer to run: it picks the driver before it writes anything, so
with none ready your project is left as it was; the writer is no longer re-run
when its check cannot start (only when the check finds problems); a file the
writer hides in an ignored path is refused; and a commit hook that rewrites a
written workflow is reported. The proposer's suggestions are now checked inside
`ork onboard`, so a long list no longer fails the run; `ork:onboard-propose` run
alone returns them unfiltered, and the hidden `ork __onboard filter` is gone.
Built-in workflows also refuse a folder where Ork would write one of their
files, and the survey keeps `packageManager` to one line.
