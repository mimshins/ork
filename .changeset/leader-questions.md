---
"@krapht/ork": minor
---

A leader can answer its children's questions: with `questions: owner` on a
`claude.leader`, a child's `ask_user` goes first to a read-only fork of the
leader's session, which answers when its task already settles the question, or
passes it on to you with a note. The fork can only read files, and has 3 turns
and 5 minutes. You're asked as before when the leader has no session yet or the
fork fails or runs out. The fork's cost is the run's, against the leader, and
its lines in the logs say `fork`. Every answer records who gave it:
`ork decide --list`, the transcript and the Decisions panel show the leader that
answered or passed a question on. The default, `questions: user`, changes
nothing. The `answer` tool takes an optional note.
