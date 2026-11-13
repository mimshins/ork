---
"@krapht/ork": minor
---

The browser view and `ork mcp` filter lists by the same fields as the CLI. The
server's list routes (`runs`, `usage`, `decisions`, a project's `follow-ups`,
`feedback` and `worktrees`) take each list's fields by their flag names
(`status`, `workflow`, `project`, `since`, `until`, `kind`, `severity`, `due`,
`for`, `run`) with the CLI's value forms and words (a wrong value is a 400), and
`GET /api/list-fields` serves their descriptions. All six list panels share one
filter bar built from them, with the matching `ork` command and **Clear
filter**, and `ork mcp`'s `runs`, `usage` and `decisions` tools take the same
fields. `GET /api/runs` matches `status=paused` and `crashed` by the live status
a run shows, as `ork ps` does. The old parameters keep working (`usage`'s ISO
times, follow-ups' `open`). The Usage panel's period is now the bar's `since`
(default `30d`) instead of a 7, 30, 90 days or all select.
