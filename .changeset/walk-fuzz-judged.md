---
"@krapht/ork": patch
---

Walking a workflow now says only what it tried: "no way the walk tried reaches
`x`", not that no way does. It holds those warnings back in more places where
they'd be wrong, such as a join behind a node that can run twice, a wait an
input can end, or a gate's answer read through a router, and a walk of layered
routers no longer takes minutes. A tool whose JSON says it failed is tried on
exit 0 too. A failed Claude node keeps its branch. Logs and Chats show what a
node said when it finished, and why it failed, exactly as written.
