---
"@krapht/ork": patch
---

The `issues` workflow is safer by default. A run that fails before its pull
request takes `in-progress` off every issue it listed (and still ends `failed`);
`list` refuses more than 10 issue numbers, a checkout with no commit or no
`origin`, and takes a number named twice once; a label run skips issues already
`in-progress`; and `gather` says whether a builder failed or left no branch. A
failed tool step shows the last line of its stderr without `--verbose`;
`ork init --issues` names the driver `issues` runs on and whether it is ready;
the no-commit hint says to make a first commit; and the walk summary reads "N
end succeeded, M end failed" instead of "M fail".
